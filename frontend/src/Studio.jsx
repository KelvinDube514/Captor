import { useEffect, useRef } from 'react';
import {
  AudioLines,
  Bot,
  Check,
  Circle,
  Clipboard,
  CloudUpload,
  Download,
  FileAudio,
  LoaderCircle,
  MonitorUp,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  Video,
  X,
} from 'lucide-react';
import './Studio.css';

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainder = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

export default function Studio({
  file,
  transcript,
  isTranscribing,
  isRecording,
  recordingSeconds,
  error,
  apiState,
  mode,
  setMode,
  acceptFile,
  startRecording,
  stopRecording,
  handleTranscribe,
  clearFile,
  copyTranscript,
  downloadTranscript,
  llmProvider,
  llmModels,
  selectedModel,
  setSelectedModel,
  llmStatus,
  llmMessage,
  setLlmProvider,
  setLlmStatus,
  setModelRefresh,
  meetingQuestion,
  setMeetingQuestion,
  meetingAnswer,
  isMeetingAnswering,
  meetingError,
  askMeetingTranscript,
  setWorkspace,
}) {
  const inputRef = useRef(null);
  const providerName = llmProvider === 'gemini' ? 'Google Gemini' : llmProvider === 'openai' ? 'OpenAI' : 'Ollama';

  useEffect(() => {
    if (file && inputRef.current) inputRef.current.value = '';
  }, [file]);

  return (
    <div className="studio-app">
      <header className="studio-topbar">
        <a className="studio-brand" href="/" aria-label="Parakeet Studio home">
          <span className="studio-brand-mark"><AudioLines size={20} /></span>
          <span>parakeet<span>/studio</span></span>
        </a>
        <div className={`studio-engine engine-${apiState}`}><span /> PARakeet {apiState === 'offline' ? 'offline' : 'ready on demand'}</div>
      </header>

      <main className="studio-main">
        <section className="studio-intro">
          <div>
            <div className="studio-eyebrow"><i /> RECORD, REVIEW, REHEARSE</div>
            <h1>Make every conversation<br /><span>work harder for you.</span></h1>
            <p>Capture a meeting you’re allowed to record. Get the transcript, then reflect or practice what comes next.</p>
          </div>
          <div className="studio-private"><Check size={14} /> Visible capture <b>·</b> User controlled</div>
        </section>

        <nav className="studio-tabs" aria-label="Workspace">
          <button className="studio-tab active"><Video size={16} /> Studio</button>
          <button className="studio-tab" onClick={() => setWorkspace('documents')}><FileAudio size={16} /> Document Q&amp;A</button>
        </nav>

        <div className="studio-grid">
          <section className="studio-capture-panel" aria-labelledby="capture-title">
            <div className="studio-panel-head">
              <div><span className="studio-step">01 / CAPTURE</span><h2 id="capture-title">Start with a session</h2></div>
              <span className={`capture-state${isRecording ? ' is-live' : ''}`}><i /> {isRecording ? 'RECORDING' : 'READY'}</span>
            </div>

            <div className="capture-mode" role="group" aria-label="Session source">
              <button className={mode === 'screen' ? 'selected' : ''} onClick={() => setMode('screen')} disabled={isRecording}><MonitorUp size={16} /> Share a tab or screen</button>
              <button className={mode === 'upload' ? 'selected' : ''} onClick={() => setMode('upload')} disabled={isRecording}><CloudUpload size={16} /> Upload a recording</button>
            </div>

            {mode === 'screen' ? (
              <div className={`capture-stage${isRecording ? ' live' : ''}`}>
                <div className="capture-art" aria-hidden="true"><div className="capture-art-window"><div /><div /><div /><span><AudioLines size={31} /></span></div><i className="capture-art-orbit orbit-one" /><i className="capture-art-orbit orbit-two" /></div>
                {isRecording ? <>
                  <div className="capture-clock"><span className="live-dot" /> REC <b>{formatTime(recordingSeconds)}</b></div>
                  <p className="capture-stage-title">Session capture is on</p>
                  <p className="capture-stage-note">Recording stops when you click stop or end screen sharing.</p>
                  <button className="capture-button stop" onClick={stopRecording}><Square size={15} fill="currentColor" /> Stop capture</button>
                </> : <>
                  <p className="capture-stage-title">Choose the meeting tab or window</p>
                  <p className="capture-stage-note">Use your browser’s share dialog and enable tab/system audio.</p>
                  <button className="capture-button" onClick={startRecording} disabled={apiState === 'offline'}><MonitorUp size={16} /> Start visible capture</button>
                </>}
              </div>
            ) : (
              <div className={`capture-drop${file ? ' has-file' : ''}`} onClick={() => !file && inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); acceptFile(event.dataTransfer.files?.[0]); }} role={file ? undefined : 'button'} tabIndex={file ? undefined : 0}>
                <input ref={inputRef} className="studio-hidden-input" type="file" accept=".wav,.mp3,.m4a,.flac,.ogg,.webm,.mp4,.mov,.mkv,.mpeg,.mpga" onChange={(event) => acceptFile(event.target.files?.[0])} />
                {file ? <div className="studio-file"><span><FileAudio size={19} /></span><div><strong>{file.name}</strong><small>{formatFileSize(file.size)} · Ready for transcript</small></div><button className="studio-icon-button" onClick={(event) => { event.stopPropagation(); clearFile(); }} aria-label="Remove recording"><X size={16} /></button></div> : <><span className="drop-glyph"><CloudUpload size={22} /></span><strong>Drop a recording here</strong><small>MP4, MOV, MKV, WEBM, M4A, MP3, WAV · up to 1 GB</small><span className="drop-browse">Browse files</span></>}
              </div>
            )}

            {mode === 'screen' && file && <div className="studio-file compact-file"><span><FileAudio size={17} /></span><div><strong>{file.name}</strong><small>{formatFileSize(file.size)} · Ready for transcript</small></div><button className="studio-icon-button" onClick={clearFile} aria-label="Remove recording"><X size={16} /></button></div>}
            {error && <div className="studio-error" role="alert">{error}</div>}
            <div className="consent-note"><span>!</span><p>Only record meetings when you have permission and participants know. This tool does not join calls or record secretly.</p></div>

            {file && !transcript && <button className="studio-primary" onClick={handleTranscribe} disabled={isTranscribing || apiState === 'offline' || apiState === 'checking'}>
              {isTranscribing ? <><LoaderCircle className="studio-spin" size={17} /> Transcribing recording…</> : <><Sparkles size={16} /> Create transcript</>}
            </button>}
            {!file && !isRecording && <div className="studio-model-ready"><span className={apiState === 'offline' ? 'dot-offline' : ''} />{apiState === 'offline' ? 'Start the API service to transcribe.' : 'Parakeet loads when you create a transcript.'}</div>}

            <div className="studio-provider">
              <div className="provider-heading"><label htmlFor="studio-provider">Practice with an AI model</label><button className="studio-icon-button" onClick={() => { setLlmStatus('loading'); setModelRefresh((value) => value + 1); }} aria-label="Refresh models" title="Refresh models"><RefreshCw size={14} /></button></div>
              <select id="studio-provider" value={llmProvider} onChange={(event) => { setLlmProvider(event.target.value); setLlmStatus('loading'); }}>
                <option value="ollama">Ollama · local</option><option value="gemini">Google Gemini · cloud</option><option value="openai">OpenAI / ChatGPT · cloud</option>
              </select>
              <select aria-label="Choose AI model" value={selectedModel} disabled={llmStatus !== 'ready'} onChange={(event) => setSelectedModel(event.target.value)}>
                {llmModels.length ? llmModels.map((name) => <option key={name} value={name}>{name}</option>) : <option value="">{llmStatus === 'loading' ? 'Finding models…' : 'No models available'}</option>}
              </select>
              <small>{llmStatus === 'ready' ? `${llmModels.length} models available` : llmMessage || (llmProvider === 'ollama' ? 'Start Ollama to use local models.' : `Configure ${llmProvider === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY'} in backend/.env.`)}</small>
            </div>
          </section>

          <section className="studio-session-panel" aria-labelledby="session-title">
            <div className="studio-panel-head">
              <div><span className="studio-step">02 / REVIEW</span><h2 id="session-title">Session notes</h2></div>
              {transcript && <div className="studio-transcript-actions"><button className="studio-icon-button" onClick={copyTranscript} aria-label="Copy transcript" title="Copy transcript"><Clipboard size={16} /></button><button className="studio-icon-button" onClick={downloadTranscript} aria-label="Download transcript" title="Download transcript"><Download size={16} /></button></div>}
            </div>

            <div className={`session-transcript${transcript ? ' populated' : ''}`} aria-live="polite">
              {isTranscribing ? <div className="studio-empty"><LoaderCircle className="studio-spin" size={23} /><strong>Transcribing the session</strong><span>Parakeet is processing the recording.</span></div> : transcript ? <p>{transcript}</p> : <div className="studio-empty"><AudioLines size={27} /><strong>Your transcript will land here.</strong><span>Capture a session or upload a recording to get started.</span></div>}
            </div>

            {transcript && <>
              <form className="studio-ask" onSubmit={askMeetingTranscript}>
                <label htmlFor="studio-question">Practice or debrief after the session</label>
                <textarea id="studio-question" value={meetingQuestion} onChange={(event) => setMeetingQuestion(event.target.value)} placeholder="What were the key questions? Help me practice a stronger response…" maxLength={4000} rows={2} />
                {meetingError && <div className="studio-error" role="alert">{meetingError}</div>}
                <button className="studio-primary" type="submit" disabled={!meetingQuestion.trim() || !selectedModel || llmStatus !== 'ready' || isMeetingAnswering}>{isMeetingAnswering ? <><LoaderCircle className="studio-spin" size={16} /> Reviewing notes…</> : <><Send size={15} /> Ask about this session</>}</button>
              </form>
              {meetingAnswer && <div className="studio-answer"><div><Bot size={15} /> {providerName} · PRACTICE NOTES</div><p>{meetingAnswer}</p></div>}
            </>}
            {!transcript && <p className="session-privacy"><Circle size={7} /> Capture is user-started. AI review runs only after a transcript is ready.</p>}
          </section>
        </div>

        <footer className="studio-footer"><span>PARAKEET STUDIO <i>·</i> RECORD, REVIEW, REHEARSE</span><span>{llmProvider === 'ollama' ? 'TRANSCRIPT STAYS LOCAL' : `TRANSCRIPT TEXT SENT TO ${providerName.toUpperCase()}`}</span></footer>
      </main>
    </div>
  );
}
