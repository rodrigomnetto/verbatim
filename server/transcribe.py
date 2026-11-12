"""Isolated, bounded transcription job. Only accepts a YouTube video ID."""
import contextlib
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
from urllib.parse import parse_qs, urlparse


class TranscriptError(Exception):
    pass


def validate_id(video_id):
    if not isinstance(video_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{11}', video_id):
        raise TranscriptError('Invalid YouTube video ID.')
    return video_id


def english_track(info):
    """Prefer creator captions, then automatic English (never translated tracks)."""
    for key, source in [('subtitles', 'manual'), ('automatic_captions', 'auto')]:
        tracks = info.get(key) or {}
        languages = sorted((k for k in tracks if k == 'en' or k.startswith('en-')), key=lambda k: (k != 'en', k))
        for language in languages:
            if any(t.get('ext') == 'json3' and 'tlang' not in parse_qs(urlparse(t.get('url', '')).query) for t in tracks[language]):
                return language, source
    return None


def normalize_json3(data):
    cues = []
    for event in data.get('events', []):
        start, duration = event.get('tStartMs'), event.get('dDurationMs')
        text = ''.join(s.get('utf8', '') for s in event.get('segs', [])).strip()
        text = ' '.join(text.split())
        if not text or not all(isinstance(n, (int, float)) and math.isfinite(n) and n >= 0 for n in (start, duration)) or duration <= 0:
            continue
        cues.append({'startMs': round(start), 'durationMs': max(1, round(duration)), 'text': text})
    cues.sort(key=lambda c: c['startMs'])
    # Rolling automatic captions often repeat the preceding line. Remove only
    # overlapping repeated words, preserving repetitions at distinct timestamps.
    result = []
    for cue in cues:
        if result:
            previous = result[-1]
            if cue['startMs'] < previous['startMs'] + previous['durationMs']:
                words, old = cue['text'].split(), previous['text'].split()
                overlap = next((n for n in range(min(len(words), len(old)), 0, -1) if old[-n:] == words[:n]), 0)
                if overlap:
                    cue = {**cue, 'text': ' '.join(words[overlap:])}
        if cue['text']:
            result.append(cue)
    return result


def check_video(info):
    if info.get('is_live') or info.get('live_status') == 'is_upcoming':
        raise TranscriptError('Live and upcoming videos are not supported. Choose a recorded video.')
    duration = info.get('duration')
    if not isinstance(duration, (int, float)) or not math.isfinite(duration) or duration <= 0:
        raise TranscriptError('Could not determine the video duration.')
    if duration > 3600:
        raise TranscriptError('Automatic transcription currently supports videos up to 60 minutes.')
    if info.get('availability') in ('private', 'premium_only', 'subscriber_only', 'needs_auth') or (info.get('age_limit') or 0) >= 18:
        raise TranscriptError('This video requires restricted access and cannot be transcribed.')


def transcribe(video_id):
    validate_id(video_id)
    try:
        from yt_dlp import YoutubeDL
    except ImportError:
        raise TranscriptError('Transcription dependencies are missing. Install server/requirements.txt in the server virtual environment.')
    url = f'https://www.youtube.com/watch?v={video_id}'
    options = {'quiet': True, 'no_warnings': True, 'noplaylist': True,
               'socket_timeout': 20, 'retries': 0, 'extractor_retries': 0,
               'fragment_retries': 0, 'nocheckcertificate': False,
               'playlistend': 1, 'js_runtimes': {'node': {}}}
    with tempfile.TemporaryDirectory(prefix='english-studio-') as folder:
        options['outtmpl'] = str(Path(folder) / 'audio.%(ext)s')
        with YoutubeDL(options) as ydl:
            info = ydl.extract_info(url, download=False)
            check_video(info)
        selected = english_track(info)
        if selected:
            language, source = selected
            caption_options = {**options, 'skip_download': True, 'writesubtitles': source == 'manual',
                               'writeautomaticsub': source == 'auto', 'subtitleslangs': [language], 'subtitlesformat': 'json3'}
            with YoutubeDL(caption_options) as ydl:
                # Reuse metadata; do not make a second extraction request.
                ydl.process_ie_result(info, download=True)
            files = list(Path(folder).glob('*.json3'))
            if not files:
                raise TranscriptError('YouTube did not return the caption file. Try again later.')
            cues = normalize_json3(json.loads(files[0].read_text(encoding='utf-8')))
            if cues:
                return [{'languageCode': language, 'source': source, 'cues': cues}]
        # Caption download/access errors do not fall through here. Speech
        # recognition is used only when no usable English captions exist.
        try:
            from faster_whisper import WhisperModel
        except ImportError:
            raise TranscriptError('Speech recognition is not installed. Install server/requirements.txt and restart the service.')
        with YoutubeDL({**options, 'format': 'bestaudio/best', 'max_filesize': 150_000_000}) as ydl:
            ydl.extract_info(url, download=True)
        audio = [p for p in Path(folder).glob('audio.*') if p.suffix not in ('.json3', '.part', '.ytdl')]
        if not audio:
            raise TranscriptError('No accessible audio was available for speech recognition.')
        # CPU int8 works without a GPU or paid transcription service. PyAV
        # decodes audio; system ffmpeg is not required for this path.
        model = WhisperModel(os.environ.get('WHISPER_MODEL', 'base.en'), device='cpu', compute_type='int8')
        segments, metadata = model.transcribe(str(audio[0]), language='en', vad_filter=True, beam_size=5)
        cues = [{'startMs': round(s.start * 1000), 'durationMs': max(1, round((s.end - s.start) * 1000)), 'text': s.text.strip()}
                for s in segments if s.text.strip() and s.end > s.start]
        if not cues:
            raise TranscriptError('No English speech was detected in this video.')
        return [{'languageCode': metadata.language, 'source': 'generated', 'cues': cues}]


if __name__ == '__main__':
    try:
        # Keep the stdout protocol clean even if a dependency prints progress.
        with contextlib.redirect_stdout(sys.stderr):
            tracks = transcribe(sys.argv[1] if len(sys.argv) == 2 else '')
        print(json.dumps({'tracks': tracks}))
    except TranscriptError as exc:
        print(json.dumps({'error': str(exc)}))
        sys.exit(1)
    except Exception:
        # Do not forward dependency errors containing signed URLs or paths.
        print(json.dumps({'error': 'YouTube or the speech model could not be accessed. Check your connection and server setup. Restricted, rate-limited, and bot-blocked videos are not bypassed.'}))
        sys.exit(1)
