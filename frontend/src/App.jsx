import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AudioLines,
  Bot,
  Check,
  Clipboard,
  CloudUpload,
  Download,
  FileAudio,
  FileText,
  LoaderCircle,
  Mic,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import './App.css';
import Studio from './Studio.jsx';

const MAX_FILE_SIZE = 1024 * 1024 * 1024;
const ACCEPTED_TYPES = '.wav,.mp3,.m4a,.flac,.ogg,.webm,.mp4,.mov,.mkv,.mpeg,.mpga';
const MAX_DOCUMENT_SIZE = 15 * 1024 * 1024;
const ACCEPTED_DOCUMENTS = '.pdf,.docx,.txt,.md,.csv,.json';
const ACCEPTED_DOCUMENT_EXTENSIONS = new Set(['pdf', 'docx', 'txt', 'md', 'csv', 'json']);

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainder = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function extensionForMimeType(mimeType) {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4')) return 'mp4';
  return 'webm';
}

function App() {
  const [workspace, setWorkspace] = useState('studio');
  const [mode, setMode] = useState('screen');
  const [file, setFile] = useState(null);
  const [transcript, setTranscript] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState('');
  const [apiState, setApiState] = useState('checking');
  const [copied, setCopied] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [question, setQuestion] = useState('');
  const [askedQuestion, setAskedQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [answerSources, setAnswerSources] = useState([]);
  const [isAnswering, setIsAnswering] = useState(false);
  const [documentError, setDocumentError] = useState('');
  const [llmModels, setLlmModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [llmProvider, setLlmProvider] = useState('ollama');
  const [llmStatus, setLlmStatus] = useState('idle');
  const [llmMessage, setLlmMessage] = useState('');
  const [modelRefresh, setModelRefresh] = useState(0);
  const [meetingQuestion, setMeetingQuestion] = useState('');
  const [meetingAskedQuestion, setMeetingAskedQuestion] = useState('');
  const [meetingAnswer, setMeetingAnswer] = useState('');
  const [meetingError, setMeetingError] = useState('');
  const [isMeetingAnswering, setIsMeetingAnswering] = useState(false);
  const inputRef = useRef(null);
  const documentInputRef = useRef(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);

  useEffect(() => {
    let active = true;
    const checkBackend = async () => {
      try {
        const response = await fetch('/api/health');
        const data = await response.json();
        if (active) setApiState(data.model_loaded ? 'ready' : 'loading');
      } catch {
        if (active) setApiState('offline');
      }
    };

    checkBackend();
    const intervalId = window.setInterval(checkBackend, 8000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (workspace === 'audio') return undefined;
    let active = true;
    setLlmStatus('loading');
    fetch(`/api/llm/models?provider=${encodeURIComponent(llmProvider)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || `Could not load ${llmProvider} models.`);
        if (!active) return;
        const models = data.models || [];
        setLlmModels(models);
        const preferredModels = llmProvider === 'gemini'
          ? ['models/gemini-2.5-flash', 'models/gemini-flash-latest']
          : llmProvider === 'openai' ? ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o'] : [];
        const preferredModel = preferredModels.find((modelName) => models.includes(modelName)) || models[0] || '';
        setSelectedModel((current) => models.includes(current) ? current : preferredModel);
        setLlmMessage('');
        setLlmStatus(models.length ? 'ready' : 'empty');
      })
      .catch((requestError) => {
        if (!active) return;
        setLlmModels([]);
        setSelectedModel('');
        setLlmMessage(requestError.message || `Could not connect to ${llmProvider}.`);
        setLlmStatus('offline');
      });
    return () => { active = false; };
  }, [workspace, modelRefresh, llmProvider]);

  useEffect(() => {
    if (!isRecording) return undefined;
    const intervalId = window.setInterval(() => setRecordingSeconds((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(intervalId);
  }, [isRecording]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const acceptFile = (nextFile) => {
    if (!nextFile) return;
    if (nextFile.size > MAX_FILE_SIZE) {
      setError('That file is over the 1 GB limit. Choose a smaller recording.');
      return;
    }
    setFile(nextFile);
    setTranscript('');
    setMeetingAnswer('');
    setMeetingAskedQuestion('');
    setError('');
  };

  const handleFileInput = (event) => acceptFile(event.target.files?.[0]);

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    acceptFile(event.dataTransfer.files?.[0]);
  };

  const addDocuments = (fileList) => {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    const invalidFile = incoming.find((item) => !ACCEPTED_DOCUMENT_EXTENSIONS.has(item.name.split('.').pop().toLowerCase()));
    if (invalidFile) {
      setDocumentError(`${invalidFile.name} is not a supported document. Choose PDF, DOCX, TXT, MD, CSV, or JSON.`);
      return;
    }
    if (incoming.some((item) => item.size > MAX_DOCUMENT_SIZE)) {
      setDocumentError('Each document must be smaller than 15 MB.');
      return;
    }
    const nextDocuments = [...documents, ...incoming];
    if (nextDocuments.length > 8 || nextDocuments.reduce((total, item) => total + item.size, 0) > 30 * 1024 * 1024) {
      setDocumentError('Add up to 8 documents, with a combined size under 30 MB.');
      return;
    }
    setDocuments(nextDocuments);
    setDocumentError('');
    setAnswer('');
    setAnswerSources([]);
  };

  const removeDocument = (index) => {
    setDocuments((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setAnswer('');
    setAnswerSources([]);
  };

  const askDocuments = async (event) => {
    event.preventDefault();
    if (!documents.length || !question.trim() || !selectedModel || isAnswering) return;
    setIsAnswering(true);
    setDocumentError('');
    setAnswer('');
    setAnswerSources([]);
    setAskedQuestion(question.trim());

    const formData = new FormData();
    formData.append('question', question.trim());
    formData.append('model', selectedModel);
    formData.append('provider', llmProvider);
    documents.forEach((document) => formData.append('files', document));

    try {
      const response = await fetch('/api/documents/ask', { method: 'POST', body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Could not answer that question.');
      setAnswer(data.answer);
      setAnswerSources(data.sources || []);
    } catch (requestError) {
      setDocumentError(requestError.message || 'Could not reach the local language model.');
    } finally {
      setIsAnswering(false);
    }
  };

  const askMeetingTranscript = async (event) => {
    event.preventDefault();
    if (!transcript.trim() || !meetingQuestion.trim() || !selectedModel || isMeetingAnswering) return;
    setIsMeetingAnswering(true);
    setMeetingError('');
    setMeetingAnswer('');
    setMeetingAskedQuestion(meetingQuestion.trim());

    const transcriptFile = new File([transcript], `${file?.name.replace(/\.[^.]+$/, '') || 'meeting'}-transcript.txt`, { type: 'text/plain' });
    const formData = new FormData();
    formData.append('question', meetingQuestion.trim());
    formData.append('model', selectedModel);
    formData.append('provider', llmProvider);
    formData.append('files', transcriptFile);

    try {
      const response = await fetch('/api/documents/ask', { method: 'POST', body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Could not answer that meeting question.');
      setMeetingAnswer(data.answer);
    } catch (requestError) {
      setMeetingError(requestError.message || `Could not reach ${llmProvider}.`);
    } finally {
      setIsMeetingAnswering(false);
    }
  };

  const clearDocuments = () => {
    setDocuments([]);
    setQuestion('');
    setAskedQuestion('');
    setAnswer('');
    setAnswerSources([]);
    setDocumentError('');
    if (documentInputRef.current) documentInputRef.current.value = '';
  };

  const startRecording = async () => {
    setError('');
    if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder) {
      setError('Screen capture is not supported in this browser. Upload an exported recording instead.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: true });
      if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach((track) => track.stop());
        setError('No meeting audio was shared. Start capture again and enable tab or system audio in the share dialog.');
        return;
      }
      streamRef.current = stream;
      const supportedMimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
        .find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
      const recorder = new MediaRecorder(stream, supportedMimeType ? { mimeType: supportedMimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'video/webm';
        const recordedFile = new File(chunksRef.current, `session-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`, { type: mimeType });
        acceptFile(recordedFile);
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setIsRecording(false);
      };
      recorderRef.current = recorder;
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (recorder.state === 'recording') recorder.stop();
      }, { once: true });
      recorder.start();
      setRecordingSeconds(0);
      setIsRecording(true);
    } catch {
      setError('Screen capture was cancelled or blocked. Allow sharing in your browser and try again.');
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  };

  const handleTranscribe = async () => {
    if (!file || isTranscribing) return;
    setIsTranscribing(true);
    setTranscript('');
    setError('');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/transcribe', { method: 'POST', body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Transcription failed. Please try again.');
      setTranscript(data.transcript || 'No speech was detected in this recording.');
    } catch (requestError) {
      setError(requestError.message || 'Could not reach the transcription service. Check that the backend is running.');
    } finally {
      setIsTranscribing(false);
    }
  };

  const clearFile = () => {
    setFile(null);
    setTranscript('');
    setMeetingAnswer('');
    setMeetingAskedQuestion('');
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const copyTranscript = async () => {
    try {
      await navigator.clipboard.writeText(transcript);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Clipboard access is unavailable in this browser.');
    }
  };

  const downloadTranscript = () => {
    const url = URL.createObjectURL(new Blob([transcript], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${file?.name.replace(/\.[^.]+$/, '') || 'transcript'}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const statusLabel = {
    checking: 'Connecting to engine',
    loading: 'Parakeet loads on use',
    ready: 'Engine ready',
    offline: 'Engine offline',
  }[apiState];

  if (workspace === 'studio') {
    return <Studio
      file={file}
      transcript={transcript}
      isTranscribing={isTranscribing}
      isRecording={isRecording}
      recordingSeconds={recordingSeconds}
      error={error}
      apiState={apiState}
      mode={mode}
      setMode={setMode}
      acceptFile={acceptFile}
      startRecording={startRecording}
      stopRecording={stopRecording}
      handleTranscribe={handleTranscribe}
      clearFile={clearFile}
      copyTranscript={copyTranscript}
      downloadTranscript={downloadTranscript}
      llmProvider={llmProvider}
      llmModels={llmModels}
      selectedModel={selectedModel}
      setSelectedModel={setSelectedModel}
      llmStatus={llmStatus}
      llmMessage={llmMessage}
      setLlmProvider={setLlmProvider}
      setLlmStatus={setLlmStatus}
      setModelRefresh={setModelRefresh}
      meetingQuestion={meetingQuestion}
      setMeetingQuestion={setMeetingQuestion}
      meetingAnswer={meetingAnswer}
      isMeetingAnswering={isMeetingAnswering}
      meetingError={meetingError}
      askMeetingTranscript={askMeetingTranscript}
      setWorkspace={setWorkspace}
    />;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Parakeet Studio home">
          <span className="brand-mark"><AudioLines size={21} strokeWidth={2.2} /></span>
          <span>parakeet<span className="brand-light">/studio</span></span>
        </a>
        <div className={`engine-status engine-${apiState}`} aria-live="polite">
          <span className="status-dot" />
          <span>{statusLabel}</span>
        </div>
      </header>

      <main className="workspace">
        <section className="page-heading">
          <div>
            <div className="eyebrow"><span /> {workspace === 'audio' ? 'PRIVATE, ON-DEVICE WORKFLOW' : workspace === 'meetings' ? 'MEETING TRANSCRIPTS + AI' : 'LOCAL OR CLOUD DOCUMENT ASSISTANT'}</div>
              {workspace === 'audio' ? <h1>Audio to text,<br /><span>without the busywork.</span></h1> : workspace === 'meetings' ? <h1>Meetings, remembered.<br /><span>Answers, ready.</span></h1> : <h1>Ask your documents,<br /><span>get answers with sources.</span></h1>}
              <p className="intro">{workspace === 'audio' ? 'Drop in a recording or capture a thought. Your audio stays on this machine.' : workspace === 'meetings' ? llmProvider === 'ollama' ? 'Transcribe Teams, Zoom, and other meeting recordings, then ask questions locally.' : `Transcribe meeting recordings, then send transcript excerpts to ${llmProvider === 'gemini' ? 'Google Gemini' : 'OpenAI'} for answers.` : llmProvider === 'ollama' ? 'Bring your files and ask a question. Processing stays on this machine.' : `Bring your files and ask a question. Selected text is sent to ${llmProvider === 'gemini' ? 'Google Gemini' : 'OpenAI'} for an answer.`}</p>
          </div>
          <div className="model-tag"><Sparkles size={15} /> {workspace === 'audio' ? <>NVIDIA PARAKEET <span>·</span> 0.6B</> : workspace === 'meetings' ? <>PARAKEET + {llmProvider === 'gemini' ? 'GEMINI' : llmProvider === 'openai' ? 'OPENAI' : 'OLLAMA'}</> : <>{llmProvider === 'gemini' ? 'GOOGLE GEMINI' : llmProvider === 'openai' ? 'OPENAI' : 'OLLAMA'} <span>·</span> {llmProvider === 'ollama' ? 'LOCAL' : 'CLOUD'}</>}</div>
        </section>

        <nav className="workspace-switch" aria-label="Workspace">
          <button className="workspace-tab" onClick={() => setWorkspace('studio')}><Video size={16} /> Studio</button>
          <button className={workspace === 'documents' ? 'workspace-tab active' : 'workspace-tab'} onClick={() => setWorkspace('documents')} aria-pressed={workspace === 'documents'}><FileText size={16} /> Documents + Q&amp;A</button>
        </nav>

        {workspace === 'audio' ? <div className="work-grid">
          <section className="input-panel" aria-labelledby="source-title">
            <div className="panel-heading">
              <div className="section-index">01</div>
              <div>
                <h2 id="source-title">Choose your audio</h2>
                <p>Upload a file or record directly</p>
              </div>
            </div>

            <div className="mode-switch" role="group" aria-label="Audio source">
              <button className={mode === 'upload' ? 'mode-button active' : 'mode-button'} onClick={() => setMode('upload')} aria-pressed={mode === 'upload'}>
                <CloudUpload size={17} /> Upload file
              </button>
              <button className={mode === 'record' ? 'mode-button active' : 'mode-button'} onClick={() => setMode('record')} aria-pressed={mode === 'record'}>
                <Mic size={16} /> Record
              </button>
            </div>

            {mode === 'upload' ? (
              <div
                className={`drop-zone${isDragging ? ' is-dragging' : ''}${file ? ' has-file' : ''}`}
                onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => { if (!file) inputRef.current?.click(); }}
                onKeyDown={(event) => { if (!file && (event.key === 'Enter' || event.key === ' ')) inputRef.current?.click(); }}
                role={file ? undefined : 'button'}
                tabIndex={file ? undefined : 0}
                aria-label={file ? undefined : 'Choose an audio file or drop it here'}
              >
                <input ref={inputRef} className="visually-hidden" type="file" accept={ACCEPTED_TYPES} onChange={handleFileInput} />
                {file ? (
                  <div className="selected-file" onClick={(event) => event.stopPropagation()}>
                    <span className="file-icon"><FileAudio size={22} /></span>
                    <span className="file-copy"><strong>{file.name}</strong><small>{formatFileSize(file.size)} <span>·</span> Ready to transcribe</small></span>
                    <button className="icon-button remove-file" onClick={clearFile} aria-label="Remove audio file" title="Remove file"><X size={17} /></button>
                  </div>
                ) : (
                  <>
                    <span className="upload-icon"><CloudUpload size={23} strokeWidth={1.8} /></span>
                    <strong>Drop your audio here</strong>
                    <span className="drop-subtitle">or <span className="browse-link">browse files</span></span>
                    <span className="format-note">WAV, MP3, M4A, FLAC, OGG, WEBM <i>·</i> UP TO 1 GB</span>
                  </>
                )}
              </div>
            ) : (
              <div className={`record-panel${isRecording ? ' recording' : ''}`}>
                <div className="record-visual" aria-hidden="true">
                  <div className="record-orbit"><span /><span /><span /><span /><span /><span /><span /></div>
                </div>
                <div className="record-time">{formatTime(recordingSeconds)}</div>
                <div className="record-caption">{isRecording ? 'Recording in progress' : 'Ready when you are'}</div>
                <button className={`record-button${isRecording ? ' is-recording' : ''}`} onClick={isRecording ? stopRecording : startRecording}>
                  {isRecording ? <><Square size={15} fill="currentColor" /> Stop recording</> : <><Mic size={17} /> Start recording</>}
                </button>
                {isRecording && <span className="record-hint">Your recording will be ready to transcribe when you stop.</span>}
              </div>
            )}

            {error && <div className="error-message" role="alert"><span className="error-mark">!</span>{error}</div>}

            <div className="input-footer">
              <div className="privacy-note"><span className="privacy-mark"><Check size={12} /></span> Audio is processed locally</div>
              <span className="input-footnote">NO CLOUD UPLOAD</span>
            </div>

            <button className="transcribe-button" onClick={handleTranscribe} disabled={!file || isTranscribing || apiState === 'offline' || apiState === 'checking'}>
              {isTranscribing ? <><LoaderCircle className="spin" size={17} /> Transcribing audio...</> : <><Sparkles size={16} /> Transcribe audio <span className="button-arrow">↗</span></>}
            </button>
            {apiState !== 'ready' && !isTranscribing && <p className="backend-hint">{apiState === 'offline' ? 'Start the backend to begin transcribing.' : 'Parakeet loads the first time you transcribe.'}</p>}
          </section>

          <section className="result-panel" aria-labelledby="result-title">
            <div className="panel-heading result-heading">
              <div className="section-index">02</div>
              <div>
                <h2 id="result-title">Your transcript</h2>
                <p>{transcript ? 'Ready to review and export' : 'The words will land here'}</p>
              </div>
              {transcript && <div className="result-actions">
                <button className="icon-button" onClick={copyTranscript} aria-label={copied ? 'Copied transcript' : 'Copy transcript'} title={copied ? 'Copied' : 'Copy'}>{copied ? <Check size={17} /> : <Clipboard size={17} />}</button>
                <button className="icon-button" onClick={downloadTranscript} aria-label="Download transcript" title="Download .txt"><Download size={17} /></button>
              </div>}
            </div>

            <div className={`transcript-paper${transcript ? ' has-transcript' : ''}${isTranscribing ? ' is-processing' : ''}`} aria-live="polite">
              {isTranscribing ? (
                <div className="processing-state">
                  <div className="processing-wave"><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
                  <strong>Listening closely</strong>
                  <span>Parakeet is turning speech into text.</span>
                </div>
              ) : transcript ? (
                <>
                  <div className="transcript-label"><span className="transcript-dot" /> TRANSCRIPTION</div>
                  <p className="transcript-text">{transcript}</p>
                  <div className="transcript-meta"><Activity size={14} /> Generated locally with Parakeet</div>
                </>
              ) : (
                <div className="empty-state">
                  <div className="empty-symbol"><AudioLines size={28} strokeWidth={1.4} /></div>
                  <strong>A little quiet in here.</strong>
                  <span>Your finished transcript will appear in this space.</span>
                </div>
              )}
            </div>

            {transcript && <div className="result-footer"><span><Check size={13} /> TRANSCRIPTION COMPLETE</span><button onClick={clearFile}><RotateCcw size={14} /> New audio</button></div>}
          </section>
        </div> : workspace === 'documents' ? <div className="work-grid document-grid">
          <section className="input-panel document-input-panel" aria-labelledby="documents-title">
            <div className="panel-heading">
              <div className="section-index">01</div>
              <div><h2 id="documents-title">Your documents</h2><p>Upload files to use as your source material</p></div>
            </div>

            <div className="document-drop-zone" onClick={() => documentInputRef.current?.click()} onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={(event) => { event.preventDefault(); setIsDragging(false); addDocuments(event.dataTransfer.files); }}>
              <input ref={documentInputRef} className="visually-hidden" type="file" accept={ACCEPTED_DOCUMENTS} multiple onChange={(event) => { addDocuments(event.target.files); event.target.value = ''; }} />
              <span className="document-upload-icon"><Plus size={19} /></span>
              <span><strong>Add documents</strong><small>PDF, DOCX, TXT, MD, CSV, JSON · 15 MB each</small></span>
            </div>

            {documents.length > 0 ? <div className="document-list" aria-label="Uploaded documents">
              {documents.map((document, index) => <div className="document-row" key={`${document.name}-${index}`}>
                <span className="document-file-icon"><FileText size={16} /></span>
                <span className="document-file-name"><strong>{document.name}</strong><small>{formatFileSize(document.size)}</small></span>
                <button className="icon-button" onClick={() => removeDocument(index)} aria-label={`Remove ${document.name}`} title="Remove document"><Trash2 size={15} /></button>
              </div>)}
            </div> : <div className="document-empty-note">No documents added yet</div>}

            <div className="model-select-block">
              <div className="model-select-heading"><label htmlFor="provider-select">AI provider</label><button className="icon-button refresh-models" onClick={() => { setLlmStatus('loading'); setModelRefresh((value) => value + 1); }} aria-label="Refresh models" title="Refresh models"><RefreshCw size={14} /></button></div>
              <select id="provider-select" value={llmProvider} onChange={(event) => { setLlmProvider(event.target.value); setLlmStatus('loading'); }}>
                <option value="ollama">Ollama · local</option>
                <option value="gemini">Google Gemini · cloud</option>
                <option value="openai">OpenAI / ChatGPT · cloud</option>
              </select>
              <label htmlFor="model-select">Model</label>
              <select id="model-select" value={selectedModel} disabled={llmStatus !== 'ready'} onChange={(event) => setSelectedModel(event.target.value)}>
                {llmModels.length ? llmModels.map((modelName) => <option key={modelName} value={modelName}>{modelName}</option>) : <option value="">{llmStatus === 'loading' ? 'Finding models…' : 'No models available'}</option>}
              </select>
              <p className={`model-status model-status-${llmStatus}`}>
                {llmStatus === 'ready' ? `${llmModels.length} ${llmProvider === 'ollama' ? 'local ' : ''}model${llmModels.length === 1 ? '' : 's'} available` : llmStatus === 'loading' ? `Loading ${llmProvider} models…` : llmMessage || (llmStatus === 'empty' ? llmProvider === 'ollama' ? 'Run ollama pull qwen2.5:3b to add a model.' : 'No models available. Check API account access.' : llmProvider === 'ollama' ? 'Start Ollama to connect a local model.' : `Configure ${llmProvider === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY'} in backend/.env.`)}
              </p>
            </div>

            <form className="question-form" onSubmit={askDocuments}>
              <label htmlFor="document-question">Your question</label>
              <textarea id="document-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What would you like to know?" maxLength={4000} rows={3} />
              {documentError && <div className="error-message" role="alert"><span className="error-mark">!</span>{documentError}</div>}
              <button className="transcribe-button ask-button" type="submit" disabled={!documents.length || !question.trim() || !selectedModel || llmStatus !== 'ready' || isAnswering}>
                {isAnswering ? <><LoaderCircle className="spin" size={17} /> Reading your documents...</> : <><Send size={16} /> Ask question</>}
              </button>
            </form>
            <div className="input-footer document-privacy"><div className="privacy-note"><span className="privacy-mark"><Check size={12} /></span>{llmProvider === 'ollama' ? 'Processed by your local model' : `Sent to ${llmProvider === 'gemini' ? 'Google' : 'OpenAI'} for processing`}</div><span className="input-footnote">{llmProvider === 'ollama' ? 'LOCAL ONLY' : 'CLOUD AI'}</span></div>
          </section>

          <section className="result-panel answer-panel" aria-labelledby="answer-title">
            <div className="panel-heading result-heading">
              <div className="section-index">02</div>
              <div><h2 id="answer-title">Answer</h2><p>{answer ? `${llmProvider === 'gemini' ? 'Gemini' : llmProvider === 'openai' ? 'OpenAI' : 'Ollama'} · ${selectedModel}` : 'Grounded in your uploaded files'}</p></div>
              {documents.length > 0 && <button className="icon-button clear-documents" onClick={clearDocuments} aria-label="Clear documents and answer" title="Clear all"><X size={17} /></button>}
            </div>
            <div className={`answer-paper${answer ? ' has-answer' : ''}`} aria-live="polite">
              {isAnswering ? <div className="processing-state"><div className="processing-wave"><i /><i /><i /><i /><i /><i /><i /><i /><i /></div><strong>Reading for an answer</strong><span>{llmProvider === 'ollama' ? 'Your local model is checking the source material.' : `Sending selected text to ${llmProvider === 'gemini' ? 'Google Gemini' : 'OpenAI'}.`}</span></div> : answer ? <>
                <div className="answer-question"><span>QUESTION</span><p>{askedQuestion}</p></div>
                <div className="answer-body"><div className="answer-label"><Bot size={15} /> MODEL ANSWER</div><p>{answer}</p></div>
                <div className="answer-sources"><span>Sources</span>{answerSources.map((source) => <span className="source-chip" key={source}><FileText size={13} /> {source}</span>)}</div>
              </> : <div className="empty-state"><div className="empty-symbol"><Bot size={27} strokeWidth={1.5} /></div><strong>Your answer will appear here.</strong><span>Add documents and ask a question to get started.</span></div>}
            </div>
          </section>
        </div> : <div className="work-grid meeting-grid">
          <section className="input-panel meeting-input-panel" aria-labelledby="meeting-recording-title">
            <div className="panel-heading">
              <div className="section-index">01</div>
              <div><h2 id="meeting-recording-title">Meeting recording</h2><p>Upload an exported Teams, Zoom, or other recording</p></div>
            </div>
            <div className={`drop-zone meeting-drop-zone${isDragging ? ' is-dragging' : ''}${file ? ' has-file' : ''}`} onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={(event) => { event.preventDefault(); setIsDragging(false); acceptFile(event.dataTransfer.files?.[0]); }} onClick={() => { if (!file) inputRef.current?.click(); }} role={file ? undefined : 'button'} tabIndex={file ? undefined : 0} aria-label={file ? undefined : 'Choose a meeting recording'}>
              <input ref={inputRef} className="visually-hidden" type="file" accept={ACCEPTED_TYPES} onChange={(event) => acceptFile(event.target.files?.[0])} />
              {file ? <div className="selected-file"><span className="file-icon"><Video size={21} /></span><span className="file-copy"><strong>{file.name}</strong><small>{formatFileSize(file.size)} <span>·</span> Ready to transcribe</small></span><button className="icon-button remove-file" onClick={(event) => { event.stopPropagation(); clearFile(); }} aria-label="Remove recording" title="Remove recording"><X size={17} /></button></div> : <><span className="upload-icon"><Video size={23} strokeWidth={1.8} /></span><strong>Drop a meeting recording here</strong><span className="drop-subtitle">or <span className="browse-link">browse files</span></span><span className="format-note">MP4, MOV, MKV, M4A, MP3, WAV, WEBM <i>·</i> UP TO 1 GB</span></>}
            </div>

            {error && <div className="error-message" role="alert"><span className="error-mark">!</span>{error}</div>}
            <div className="meeting-source-note"><strong>Works with exported recordings</strong><span>Upload a Teams or Zoom recording file. Live meeting bots and account connection are not enabled.</span></div>
            <button className="transcribe-button" onClick={handleTranscribe} disabled={!file || isTranscribing || apiState === 'offline' || apiState === 'checking'}>
              {isTranscribing ? <><LoaderCircle className="spin" size={17} /> Transcribing meeting...</> : <><Sparkles size={16} /> Transcribe meeting</>}
            </button>
            {apiState !== 'ready' && !isTranscribing && <p className="backend-hint">{apiState === 'offline' ? 'Start the backend to begin transcribing.' : 'Parakeet loads the first time you transcribe.'}</p>}

            <div className="model-select-block meeting-model-block">
              <div className="model-select-heading"><label htmlFor="meeting-provider-select">Answer with</label><button className="icon-button refresh-models" onClick={() => { setLlmStatus('loading'); setModelRefresh((value) => value + 1); }} aria-label="Refresh models" title="Refresh models"><RefreshCw size={14} /></button></div>
              <select id="meeting-provider-select" value={llmProvider} onChange={(event) => { setLlmProvider(event.target.value); setLlmStatus('loading'); }}>
                <option value="ollama">Ollama · local</option><option value="gemini">Google Gemini · cloud</option><option value="openai">OpenAI / ChatGPT · cloud</option>
              </select>
              <select aria-label="Meeting answer model" value={selectedModel} disabled={llmStatus !== 'ready'} onChange={(event) => setSelectedModel(event.target.value)}>
                {llmModels.length ? llmModels.map((modelName) => <option key={modelName} value={modelName}>{modelName}</option>) : <option value="">{llmStatus === 'loading' ? 'Finding models…' : 'No models available'}</option>}
              </select>
              <p className={`model-status model-status-${llmStatus}`}>{llmStatus === 'ready' ? `${llmModels.length} ${llmProvider === 'ollama' ? 'local ' : ''}models available` : llmStatus === 'loading' ? `Loading ${llmProvider} models…` : llmMessage || (llmProvider === 'ollama' ? 'Start Ollama to connect a local model.' : `Configure ${llmProvider === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY'} in backend/.env.`)}</p>
            </div>
            <div className="input-footer document-privacy"><div className="privacy-note"><span className="privacy-mark"><Check size={12} /></span>{llmProvider === 'ollama' ? 'Transcript stays on this machine' : `Transcript sent to ${llmProvider === 'gemini' ? 'Google' : 'OpenAI'}`}</div><span className="input-footnote">{llmProvider === 'ollama' ? 'LOCAL ONLY' : 'CLOUD AI'}</span></div>
          </section>

          <section className="result-panel meeting-result-panel" aria-labelledby="meeting-transcript-title">
            <div className="panel-heading result-heading">
              <div className="section-index">02</div><div><h2 id="meeting-transcript-title">Transcript &amp; answers</h2><p>{transcript ? 'Ask anything about this meeting' : 'Your meeting transcript will appear here'}</p></div>
              {transcript && <div className="result-actions"><button className="icon-button" onClick={copyTranscript} aria-label={copied ? 'Copied transcript' : 'Copy transcript'} title={copied ? 'Copied' : 'Copy'}>{copied ? <Check size={17} /> : <Clipboard size={17} />}</button><button className="icon-button" onClick={downloadTranscript} aria-label="Download transcript" title="Download transcript"><Download size={17} /></button></div>}
            </div>
            <div className={`meeting-transcript${transcript ? ' has-transcript' : ''}`} aria-live="polite">
              {isTranscribing ? <div className="processing-state"><div className="processing-wave"><i /><i /><i /><i /><i /><i /><i /><i /><i /></div><strong>Transcribing the meeting</strong><span>Parakeet is processing the recording locally.</span></div> : transcript ? <p>{transcript}</p> : <div className="empty-state"><div className="empty-symbol"><AudioLines size={27} /></div><strong>No transcript yet.</strong><span>Upload and transcribe a meeting recording to get started.</span></div>}
            </div>
            {transcript && <form className="question-form meeting-question-form" onSubmit={askMeetingTranscript}>
              <label htmlFor="meeting-question">Ask about the meeting</label>
              <textarea id="meeting-question" value={meetingQuestion} onChange={(event) => setMeetingQuestion(event.target.value)} placeholder="What were the key decisions or action items?" maxLength={4000} rows={2} />
              {meetingError && <div className="error-message" role="alert"><span className="error-mark">!</span>{meetingError}</div>}
              <button className="transcribe-button ask-button" type="submit" disabled={!meetingQuestion.trim() || !selectedModel || llmStatus !== 'ready' || isMeetingAnswering}>{isMeetingAnswering ? <><LoaderCircle className="spin" size={17} /> Reading transcript...</> : <><Send size={16} /> Ask about meeting</>}</button>
            </form>}
            {meetingAnswer && <div className="meeting-answer"><div className="answer-label"><Bot size={15} /> {llmProvider === 'ollama' ? 'OLLAMA ANSWER' : llmProvider === 'gemini' ? 'GEMINI ANSWER' : 'OPENAI ANSWER'}</div><div className="meeting-answer-question">{meetingAskedQuestion}</div><p>{meetingAnswer}</p></div>}
          </section>
        </div>}

        <footer className="page-footer">
          <span>PARAKEET STUDIO <i>·</i> {workspace === 'audio' ? 'LOCAL SPEECH RECOGNITION' : workspace === 'meetings' ? 'MEETING TRANSCRIPTION + Q&A' : 'DOCUMENT Q&A'}</span>
          <span>{workspace === 'audio' || llmProvider === 'ollama' ? 'YOUR FILES STAY ON THIS MACHINE' : 'SELECTED DOCUMENT TEXT IS SENT TO THE CLOUD PROVIDER'}</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
