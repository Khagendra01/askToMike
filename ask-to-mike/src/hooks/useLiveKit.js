import { useState, useCallback, useRef, useEffect } from 'react'
import { Room, RoomEvent, Track, DataPacket_Kind } from 'livekit-client'

const LIVEKIT_URL = 'wss://del-hecqeidt.livekit.cloud'
const BACKEND_URL = 'http://localhost:8080'

export function useLiveKit() {
  const [isConnected, setIsConnected] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [messages, setMessages] = useState([])
  const [interimTranscript, setInterimTranscript] = useState('')
  
  const roomRef = useRef(null)
  const localStreamRef = useRef(null)
  const audioElementsRef = useRef([])

  const addMessage = useCallback((role, content, isFinal = true) => {
    if (!isFinal) {
      // Interim transcript - update the interimTranscript state
      setInterimTranscript(content)
      return
    }
    
    // Clear interim transcript
    setInterimTranscript('')
    
    const timestamp = new Date().toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    })
    setMessages(prev => [...prev, { role, content, timestamp }])
  }, [])

  const connect = useCallback(async () => {
    try {
      const roomName = 'my-room'
      const identity = `user-${Date.now()}`
      
      addMessage('assistant', 'Connecting to Mike...')
      
      // Get token from backend
      const resp = await fetch(
        `${BACKEND_URL}/api/token?room=${roomName}&identity=${identity}`
      )
      
      if (!resp.ok) {
        throw new Error(`Failed to get token: ${resp.status}`)
      }
      
      const { token } = await resp.json()
      
      // Create and configure room
      const room = new Room({
        // Enable adaptive streaming for better audio quality
        adaptiveStream: true,
        dynacast: true,
      })
      roomRef.current = room
      
      // Handle room connection
      room.on(RoomEvent.Connected, () => {
        console.log('✅ Connected to LiveKit room')
        setIsConnected(true)
      })
      
      room.on(RoomEvent.Disconnected, () => {
        console.log('🔌 Disconnected from LiveKit room')
        setIsConnected(false)
        setIsRecording(false)
        setInterimTranscript('')
        addMessage('assistant', 'Disconnected from the session.')
      })
      
      // Handle remote audio tracks (agent's voice)
      room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        console.log(`📡 Track subscribed: ${track.kind} from ${participant.identity}`)
        if (track.kind === 'audio') {
          const el = track.attach()
          el.id = `audio-${publication.trackSid}`
          document.body.appendChild(el)
          audioElementsRef.current.push(el)
          el.play().catch(console.error)
        }
      })
      
      room.on(RoomEvent.TrackUnsubscribed, (track, publication) => {
        console.log(`📡 Track unsubscribed: ${track.kind}`)
        track.detach().forEach(el => {
          el.remove()
          audioElementsRef.current = audioElementsRef.current.filter(e => e !== el)
        })
      })
      
      // Handle transcription events from the agent
      // LiveKit agents send transcription updates via the transcription event
      room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
        console.log('📝 Transcription received:', segments, 'from:', participant?.identity)
        
        segments.forEach((segment) => {
          const text = segment.text
          const isFinal = segment.final
          const isAgent = participant?.identity?.includes('agent') || 
                         participant?.identity === 'assistant' ||
                         !participant?.isLocal
          
          if (isAgent) {
            // Agent's response
            if (isFinal && text.trim()) {
              addMessage('assistant', text.trim(), true)
            } else if (!isFinal && text.trim()) {
              // Show agent's interim speech
              setInterimTranscript(`Mike: ${text}`)
            }
          } else if (participant?.isLocal) {
            // User's speech transcription
            if (isFinal && text.trim()) {
              addMessage('user', text.trim(), true)
            } else if (!isFinal && text.trim()) {
              // Show user's interim speech
              setInterimTranscript(text)
            }
          }
        })
      })
      
      // Handle data messages (for any JSON data from agent)
      room.on(RoomEvent.DataReceived, (payload, participant, kind) => {
        try {
          const decoder = new TextDecoder()
          const data = JSON.parse(decoder.decode(payload))
          console.log('📨 Data received:', data, 'from:', participant?.identity)
          
          // Handle different message types
          if (data.type === 'transcription') {
            if (data.role === 'user') {
              addMessage('user', data.text, data.final)
            } else {
              addMessage('assistant', data.text, data.final)
            }
          } else if (data.type === 'agent_response') {
            addMessage('assistant', data.text)
          }
        } catch (e) {
          // Not JSON, might be raw text
          console.log('📨 Raw data received:', payload)
        }
      })
      
      room.on(RoomEvent.ParticipantConnected, (participant) => {
        console.log(`👤 Participant connected: ${participant.identity}`)
        if (participant.identity.includes('agent')) {
          addMessage('assistant', "Hi! I'm Mike, your AI assistant. How can I help you today?")
        }
      })
      
      room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        console.log(`👤 Participant disconnected: ${participant.identity}`)
      })
      
      // Handle errors
      room.on(RoomEvent.MediaDevicesError, (error) => {
        console.error('🎤 Media device error:', error)
        addMessage('assistant', `Microphone error: ${error.message}`)
      })
      
      room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
        console.log(`📶 Connection quality: ${quality} for ${participant.identity}`)
      })
      
      // Connect to LiveKit
      console.log('🔗 Connecting to LiveKit...')
      await room.connect(LIVEKIT_URL, token)
      console.log('✅ Room connected, preparing microphone...')
      
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      })
      
      localStreamRef.current = stream
      const audioTrack = stream.getAudioTracks()[0]
      
      // Publish microphone track
      console.log('🎤 Publishing microphone track...')
      await room.localParticipant.publishTrack(audioTrack, {
        name: 'mic',
        source: Track.Source.Microphone
      })
      
      console.log('✅ Microphone published, ready to record')
      setIsRecording(true)
      
    } catch (error) {
      console.error('❌ Connection error:', error)
      addMessage('assistant', `Connection failed: ${error.message}`)
      setIsConnected(false)
      setIsRecording(false)
    }
  }, [addMessage])

  const disconnect = useCallback(async () => {
    try {
      // Stop local audio
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop())
        localStreamRef.current = null
      }
      
      // Remove audio elements
      audioElementsRef.current.forEach(el => el.remove())
      audioElementsRef.current = []
      
      // Disconnect from room
      if (roomRef.current) {
        await roomRef.current.disconnect()
        roomRef.current = null
      }
      
      setIsConnected(false)
      setIsRecording(false)
      setInterimTranscript('')
    } catch (error) {
      console.error('Disconnect error:', error)
    }
  }, [])

  const toggleVoice = useCallback(async () => {
    if (!roomRef.current || !localStreamRef.current) return
    
    const audioTrack = localStreamRef.current.getAudioTracks()[0]
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled
      setIsRecording(audioTrack.enabled)
      
      if (audioTrack.enabled) {
        setInterimTranscript('')
      }
    }
  }, [])

  const sendMessage = useCallback(async (content) => {
    // Add user message to chat
    addMessage('user', content)
    
    // Send text message via data channel if connected
    if (roomRef.current && isConnected) {
      try {
        const encoder = new TextEncoder()
        const data = encoder.encode(JSON.stringify({
          type: 'user_message',
          text: content
        }))
        await roomRef.current.localParticipant.publishData(data, DataPacket_Kind.RELIABLE)
        console.log('📤 Sent text message via data channel')
      } catch (error) {
        console.error('Failed to send message:', error)
      }
    }
  }, [addMessage, isConnected])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (roomRef.current) {
        roomRef.current.disconnect()
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop())
      }
      audioElementsRef.current.forEach(el => el.remove())
    }
  }, [])

  return {
    isConnected,
    isRecording,
    messages,
    interimTranscript,
    connect,
    disconnect,
    toggleVoice,
    sendMessage
  }
}
