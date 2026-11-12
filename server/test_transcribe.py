import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from transcribe import TranscriptError, check_video, english_track, normalize_json3, transcribe, validate_id

ID = 'dQw4w9WgXcQ'


class TranscriptionTests(unittest.TestCase):
    def test_id_validation(self):
        self.assertEqual(validate_id(ID), ID)
        for invalid in ['https://youtube.com/watch?v=' + ID, '../bad', None, 'short']:
            with self.assertRaises(TranscriptError):
                validate_id(invalid)

    def test_track_preference(self):
        self.assertEqual(english_track({'subtitles': {'en-US': [{'ext': 'json3'}]}, 'automatic_captions': {'en': [{'ext': 'json3'}]}}), ('en-US', 'manual'))
        self.assertEqual(english_track({'automatic_captions': {'en-orig': [{'ext': 'json3'}]}}), ('en-orig', 'auto'))
        self.assertIsNone(english_track({'subtitles': {'fr': [{'ext': 'json3'}]}}))
        self.assertIsNone(english_track({'automatic_captions': {'en': [{'ext': 'json3', 'url': 'https://www.youtube.com/api/timedtext?lang=fr&tlang=en'}]}}))

    def test_caption_normalization(self):
        events = [{'tStartMs': 0, 'dDurationMs': 2000, 'segs': [{'utf8': 'Hello world'}]},
                  {'tStartMs': 1000, 'dDurationMs': 2000, 'segs': [{'utf8': 'Hello world again'}]},
                  {'tStartMs': 4000, 'dDurationMs': 1000, 'segs': [{'utf8': 'again'}]},
                  {'tStartMs': -1, 'dDurationMs': 100, 'segs': [{'utf8': 'bad'}]}]
        self.assertEqual([c['text'] for c in normalize_json3({'events': events})], ['Hello world', 'again', 'again'])

    def test_restricted_live_and_long_video(self):
        check_video({'duration': 120})
        for info in [{'duration': 3601}, {'duration': 10, 'is_live': True}, {'duration': 10, 'availability': 'private'}, {'duration': 10, 'age_limit': 18}, {'duration': None}]:
            with self.assertRaises(TranscriptError):
                check_video(info)

    def fake_downloader(self, info, caption=None, blocked=False):
        class Downloader:
            def __init__(self, options):
                self.options = options
            def __enter__(self):
                return self
            def __exit__(self, *_):
                pass
            def extract_info(self, url, download=False):
                if download:
                    Path(self.options['outtmpl'].replace('%(ext)s', 'webm')).write_bytes(b'audio')
                return info
            def process_ie_result(self, metadata, download=False):
                if blocked:
                    raise RuntimeError('blocked')
                Path(self.options['outtmpl'].replace('%(ext)s', 'en.json3')).write_text(json.dumps(caption))
        return SimpleNamespace(YoutubeDL=Downloader)

    def test_caption_job_without_whisper(self):
        info = {'duration': 30, 'subtitles': {'en': [{'ext': 'json3'}]}}
        caption = {'events': [{'tStartMs': 0, 'dDurationMs': 1000, 'segs': [{'utf8': 'Hello'}]}]}
        with patch.dict(sys.modules, {'yt_dlp': self.fake_downloader(info, caption)}):
            tracks = transcribe(ID)
        self.assertEqual(tracks[0]['source'], 'manual')
        self.assertEqual(tracks[0]['cues'][0]['text'], 'Hello')

    def test_speech_fallback_and_temp_cleanup(self):
        paths = []
        class Model:
            def __init__(self, *args, **kwargs):
                pass
            def transcribe(self, path, **kwargs):
                paths.append(Path(path))
                return iter([SimpleNamespace(start=1.25, end=2.5, text=' Hello there ')]), SimpleNamespace(language='en')
        with patch.dict(sys.modules, {'yt_dlp': self.fake_downloader({'duration': 10}), 'faster_whisper': SimpleNamespace(WhisperModel=Model)}):
            tracks = transcribe(ID)
        self.assertEqual(tracks, [{'languageCode': 'en', 'source': 'generated', 'cues': [{'startMs': 1250, 'durationMs': 1250, 'text': 'Hello there'}]}])
        self.assertFalse(paths[0].exists())

    def test_blocked_caption_does_not_trigger_audio_download(self):
        info = {'duration': 30, 'subtitles': {'en': [{'ext': 'json3'}]}}
        with patch.dict(sys.modules, {'yt_dlp': self.fake_downloader(info, blocked=True)}):
            with self.assertRaisesRegex(RuntimeError, 'blocked'):
                transcribe(ID)


if __name__ == '__main__':
    unittest.main()
