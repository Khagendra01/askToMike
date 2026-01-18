import { useState, useRef, useEffect } from 'react'
import Message from './Message'
import Waveform from './Waveform'

const BOB_AVATAR = "https://lh3.googleusercontent.com/aida-public/AB6AXuCxQqaGItOZji-_GVFAVOolS45cDQxKKSssHrCqioVn_2Qm-xDjmvNbqA9y7ejL7va2QHALxWHdjHcFAKDiDw82DfBVls1Sc9W6kHryrr4t9IaqWSg_-5XLyQdtfweMBsCpVa0VnBviI0vbKNT0VnRJBGuRvT5VukTUr0m6qPsqUWmyWD6S3Du9ySKvhVD-ZK5-yVryLM6f48OT4x-DmX_W7aEObmxVcuOLKWab5PSiJLeu-p6l_U8vjtARZxuIsgzkoE4Ndhtzpt4p"

export default function ChatPanel({
  messages,
  isConnected,
  isRecording,
  interimTranscript = '',
  onSendMessage,
  onConnect,
  onDisconnect,
  onToggleVoice
}) {
  const [inputText, setInputText] = useState('')
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px'
    }
  }, [inputText])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (inputText.trim() && isConnected) {
      onSendMessage(inputText.trim())
      setInputText('')
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <div className="glass-panel w-full max-w-[800px] h-[75vh] rounded-2xl flex flex-col overflow-hidden transition-all duration-300">
      {/* Panel Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/[0.02]">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            {isConnected ? (
              <>
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
              </>
            ) : (null
            //   <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white border" />
            )}
          </span>
          <span className="text-xs font-medium text-white/50 uppercase tracking-widest">
            {isConnected ? 'Bob is Online' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isConnected && (
            <button 
              onClick={onDisconnect}
              className="flex items-center justify-center text-red-400 hover:text-red-300 transition-colors p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 cursor-pointer"
              title="Disconnect"
            >
              <span className="material-symbols-outlined text-sm">call_end</span>
            </button>
          )}
          <button className="flex items-center justify-center text-white/40 hover:text-white transition-colors p-2 rounded-lg hover:bg-white/5">
            <span className="material-symbols-outlined text-sm">more_horiz</span>
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {!isConnected && messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div 
              className="w-20 h-20 rounded-full bg-cover bg-center mb-6 ring-4 ring-primary/20 shadow-lg shadow-primary/10"
              style={{ backgroundImage: `url('${BOB_AVATAR}')` }}
            />
            <h3 className="text-xl font-semibold text-white/90 mb-2">Meet Bob</h3>
            <p className="text-white/50 mb-6 max-w-sm">
              Your advanced AI voice assistant. Click below to start a conversation.
            </p>
            <button
              onClick={onConnect}
              className="flex mt-4 items-center gap-2 px-6 py-3 rounded-full bg-primary hover:bg-blue-600 text-white font-medium shadow-lg shadow-primary/30 hover:shadow-primary/50 transition-all duration-200 animate-pulse-glow cursor-pointer"
            >
              <span className="material-symbols-outlined">phone_in_talk</span>
              Start Yelling
            </button>
          </div>
        ) : (
          <>
            <div className="flex justify-center">
              <span className="text-[11px] font-medium text-white/20 uppercase tracking-wider bg-black/20 px-3 py-1 rounded-full backdrop-blur-sm">
                Today
              </span>
            </div>
            
            {messages.map((msg, index) => (
              <Message key={index} message={msg} />
            ))}
            
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input Area */}
      <div className="p-4 bg-black/20 border-t border-white/5 backdrop-blur-xl">
        <form onSubmit={handleSubmit}>
          <div className={`relative flex items-end gap-2 p-1.5 glass-input rounded-xl transition-all ${isConnected ? 'focus-within:ring-1 focus-within:ring-primary/50 focus-within:bg-black/40' : 'opacity-60'}`}>
            <div className="flex-1 flex flex-col justify-center min-h-[48px]">
              {/* Waveform visualization */}
              <Waveform isActive={isRecording} />
              
              {/* Real-time transcription display when recording */}
              {isRecording && interimTranscript && (
                <div className="px-3 py-1 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-white/70 italic text-sm">{interimTranscript}</span>
                </div>
              )}
              
              {/* Show "Listening..." when recording but no transcript yet */}
              {isRecording && !interimTranscript && (
                <div className="px-3 py-1 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-white/40 italic text-sm">Listening...</span>
                </div>
              )}
              
              {/* Regular text input when not recording */}
              {!isRecording && (
                <textarea
                  ref={textareaRef}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full bg-transparent border-none text-white placeholder-white/40 focus:ring-0 resize-none py-1 px-3 max-h-[120px] text-base leading-relaxed focus:outline-none"
                  placeholder={isConnected ? "Yell to Bob..." : "Connect to start yelling..."}
                  rows={1}
                  disabled={!isConnected}
                />
              )}
            </div>
            
            <div className="flex items-center gap-2 pb-1.5 pr-1.5">
              <button 
                type="button"
                className="flex items-center justify-center p-2 text-white/40 hover:text-white/80 transition-colors rounded-lg hover:bg-white/5 disabled:opacity-40"
                title="Upload file"
                disabled={!isConnected}
              >
                <span className="material-symbols-outlined">attach_file</span>
              </button>
              
              <div className="relative group/mic">
                <button
                  type="button"
                  onClick={onToggleVoice}
                  disabled={!isConnected}
                  className={`relative z-10 flex items-center justify-center h-10 w-10 rounded-full transition-all duration-300 border ${
                    isRecording 
                      ? 'bg-red-500 border-red-500 text-white animate-pulse-glow' 
                      : 'bg-white/10 hover:bg-primary border-white/10 hover:border-primary text-white group-hover/mic:scale-105'
                  } disabled:opacity-40 disabled:hover:scale-100 disabled:hover:bg-white/10`}
                  title={isRecording ? "Stop Recording" : "Use Voice"}
                >
                  <span className="material-symbols-outlined">
                    {isRecording ? 'mic' : 'mic'}
                  </span>
                </button>
                {!isRecording && isConnected && (
                  <div className="absolute inset-0 rounded-full bg-primary/20 blur-md opacity-0 group-hover/mic:opacity-100 transition-opacity" />
                )}
              </div>
              
              <button
                type="submit"
                disabled={!inputText.trim() || !isConnected}
                className="flex items-center justify-center h-10 w-10 rounded-xl bg-primary hover:bg-blue-600 text-white shadow-lg shadow-blue-500/20 hover:shadow-blue-500/40 transition-all duration-200 disabled:opacity-40 disabled:hover:bg-primary disabled:hover:shadow-blue-500/20"
                title="Send Message"
              >
                <span className="material-symbols-outlined">arrow_upward</span>
              </button>
            </div>
          </div>
        </form>
        
        <div className="mt-2 text-center">
          <p className="text-[10px] text-white/30 font-light">
            Bob can make mistakes. Consider checking important information.
          </p>
        </div>
      </div>
    </div>
  )
}
