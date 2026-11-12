# Verbatim

Aplicativo desktop local de estudo de inglês, feito com Electron, React, TypeScript e SQLite. Baseado nos fluxos do projeto irmão English Notes, com foco em **entender inglês em inglês**, em vez de traduzir.

## Executar

Requer Node.js 22.12+ e npm. Todas as dependências são instaladas no projeto.

```sh
npm install --cache .cache/npm
npm run dev
```

O comando abre o Electron e inicia o Vite em `127.0.0.1:5173`. Para executar a versão compilada:

```sh
npm run build
npm start
```

Para gerar um instalador para o sistema atual, use `npm run dist`. O empacotamento não inclui um interpretador Python nem suas dependências.

## Configurar o Gemini

Em **Settings & data**, salve uma chave da [Google AI Studio](https://aistudio.google.com/api-keys) de um projeto no free tier. O modelo está fixado em `gemini-2.5-flash-lite`, sem troca automática para outros modelos. A elegibilidade e os limites gratuitos são definidos pelo Google; o app não modifica nem controla o faturamento do projeto.

A chave é criptografada com `safeStorage` do Electron, nunca retornada à interface e excluída dos backups. Se o armazenamento seguro do sistema estiver indisponível, o aplicativo não salva a chave em texto simples. Apenas o processo principal acessa a API. Não há chave embutida no código.

## Fluxo de estudo

1. Cole um link ou ID do YouTube na biblioteca.
2. Assista ao vídeo e acompanhe a transcrição sincronizada. Os timestamps permitem voltar ao trecho original, e a posição de reprodução é salva.
3. Selecione uma palavra ou expressão na transcrição, ou use o marcador para capturar uma frase inteira. É possível importar legendas SRT/VTT.
4. Clique em **Analyze meaning & grammar**. O Gemini apresenta o significado geral, o significado no contexto, a classe gramatical, a forma base, o tempo verbal, a identificação de phrasal verbs, observações e exemplos — em inglês.
5. Salve a expressão, acrescente notas pessoais e marque seu progresso. O caderno permite buscar, editar, excluir e filtrar por classe, tempo verbal, tags e progresso.
6. Use **Flashcards** para revisar significados, ou **Exercises** para gerar questões de completar lacunas e múltipla escolha. Escolha um assunto, uma categoria e 3, 5 ou 10 questões. A geração usa até 25 lições que correspondem ao filtro; um assunto também permite praticar sem lições salvas.
7. Confira respostas e explicações e reabra sessões no histórico. As lacunas são corrigidas pelo texto esperado, ignorando maiúsculas, espaços repetidos e pontuação final; sinônimos não são automaticamente aceitos.
8. Exporte/restaure backups JSON em Settings. A importação mescla por ID em uma transação SQLite. Backups incluem vídeos, transcrições, caderno e histórico de exercícios, mas não a chave Gemini. Backups do English Notes com schema 1 também são aceitos.

## Transcrição local opcional

Vídeos, legendas importadas, caderno e exercícios funcionam sem instalar Python. Para buscar legendas automaticamente e gerar transcrições locais com Whisper quando não há legendas disponíveis:

```sh
npm run setup:transcription
```

O script instala Python 3.11, uv, cache e o ambiente virtual dentro deste checkout (`.python`, `.tools`, `.cache`, `.venv`), sem instalar pacotes Python globalmente ou alterar perfis do shell. Não é necessário iniciar um serviço HTTP: o Electron executa o worker diretamente.

Em um app empacotado, configure `VERBATIM_PYTHON` com o caminho absoluto do Python do ambiente que contém `server/requirements.txt`. No Windows, configure essa variável com o caminho de `python.exe` de um ambiente virtual; o script de configuração fornecido requer um shell Unix.

A primeira transcrição de áudio baixa o modelo Whisper. O modelo e arquivos auxiliares ficam em `.cache` durante desenvolvimento e na pasta de dados do aplicativo na versão empacotada. Uma tarefa é executada por vez, com timeout de 15 minutos e vídeos de até 60 minutos. A integração usa yt-dlp e pode ser bloqueada pelo YouTube; legendas importadas continuam disponíveis. Use conteúdo que você tem permissão para processar. Não são usados cookies, credenciais ou mecanismos de contorno de bloqueios.

## Dados e privacidade

O banco `verbatim.sqlite` fica na pasta `userData` do Electron (no macOS, normalmente `~/Library/Application Support/Verbatim`). As notas e sessões existentes funcionam offline; reprodução YouTube, obtenção de legendas e geração Gemini precisam de conexão. Não há autenticação, analytics ou banco remoto.

O Google recebe o vídeo solicitado e os textos enviados explicitamente à análise/geração. No free tier, os dados enviados à Gemini podem ser usados para melhorar produtos do Google. A transcrição Whisper processa áudio localmente. Faça backups do seu aprendizado regularmente.

## Verificar

```sh
npm test
npm run build
npm run test:desktop
npm run test:desktop:dev
python3 -m unittest discover -s server -p 'test_*.py'
```

Os testes de Gemini usam respostas simuladas: uma chave válida é necessária para verificar chamadas reais. A disponibilidade da extração YouTube e a qualidade do conteúdo gerado dependem dos serviços externos.
