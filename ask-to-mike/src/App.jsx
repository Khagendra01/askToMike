import { useLiveKit } from './hooks/useLiveKit'
// import { useLocalVoice } from './hooks/useLocalVoice'  // Keep for local testing
import Header from './components/Header'
import ChatPanel from './components/ChatPanel'

// Background image from code.html
const BG_IMAGE = "https://lh3.googleusercontent.com/aida-public/AB6AXuBQMdg7_9FnhtqFS-GRki7yZecaC2G-ReFFrDqIXVgb_mPUDvV_y9Ooi32dWLEzeqBKNpJSiNmJLUVxdwkg2vBdZYBK7ua3OpTAbN6sgJxBS4otleDht0C_6j599a6l7fICSgH0kXtg3VOfa23SMhjjtwVmLZaORz3XJ_DT5rjXdxHqZs2NhzehaCS_dBwq9rdvm_n9WjIDwAvbv83eah6aiiriH1pZgjvi7W6Nl-mKJKNEwfwyzHIB00bDnUYkQHze2FoZVIpFdIwn"

function App() {
  const {
    isConnected,
    isRecording,
    messages,
    interimTranscript,
    connect,
    disconnect,
    toggleVoice,
    sendMessage
  } = useLiveKit()  // Connected to LiveKit backend

  return (
    <div className="relative flex h-screen w-full flex-col bg-[#101922] text-white font-['Space_Grotesk'] overflow-hidden selection:bg-primary selection:text-white">
      {/* Background */}
      <div className="absolute inset-0 z-0 w-full h-full pointer-events-none">
        <div 
          className="w-full h-full bg-cover bg-center opacity-80"
          style={{ backgroundImage: `url('${BG_IMAGE}')` }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#101922]/90 via-[#101922]/40 to-[#101922]/90" />
      </div>

      {/* Header */}
      <Header />

      {/* Main Content */}
      <main className="relative z-10 flex flex-col items-center justify-center flex-1 w-full px-4 pb-8 overflow-hidden">
        <ChatPanel
          messages={messages}
          isConnected={isConnected}
          isRecording={isRecording}
          interimTranscript={interimTranscript}
          onSendMessage={sendMessage}
          onConnect={connect}
          onDisconnect={disconnect}
          onToggleVoice={toggleVoice}
        />
      </main>
    </div>
  )
}

export default App
