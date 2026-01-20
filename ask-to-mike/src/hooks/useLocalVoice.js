import { useState, useCallback, useRef, useEffect } from 'react'

/**
 * Local voice recognition hook using Web Speech API
 * This is a development/testing hook that doesn't require backend connection.
 * Easy to swap back to useLiveKit when ready.
 */
export function useLocalVoice() {
  const [isConnected, setIsConnected] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [messages, setMessages] = useState([])
  const [interimTranscript, setInterimTranscript] = useState('')

  const recognitionRef = useRef(null)
  const isListeningRef = useRef(false)

  const addMessage = useCallback((role, content) => {
    const timestamp = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    })
    setMessages(prev => [...prev, { role, content, timestamp }])
  }, [])

  // Initialize speech recognition
  const initRecognition = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition

    if (!SpeechRecognition) {
      console.error('Speech recognition not supported')
      addMessage('assistant', 'Sorry, your browser doesn\'t support speech recognition. Please use Chrome or Edge.')
      return null
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onresult = (event) => {
      let interim = ''
      let final = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          final += transcript
        } else {
          interim += transcript
        }
      }

      // Update interim transcript for real-time display
      setInterimTranscript(interim)

      // If we have a final result, send it as a message
      if (final.trim()) {
        addMessage('user', final.trim())
        setInterimTranscript('')
      }
    }

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error)
      if (event.error === 'not-allowed') {
        addMessage('assistant', 'Microphone access denied. Please allow microphone access to use voice input.')
      } else if (event.error !== 'aborted') {
        addMessage('assistant', `Speech recognition error: ${event.error}`)
      }
      setIsRecording(false)
      isListeningRef.current = false
    }

    recognition.onend = () => {
      // Restart if we're still supposed to be recording
      if (isListeningRef.current && recognitionRef.current) {
        try {
          recognitionRef.current.start()
        } catch {
          // Already started, ignore
        }
      } else {
        setIsRecording(false)
      }
    }

    return recognition
  }, [addMessage])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        isListeningRef.current = false
        recognitionRef.current.stop()
        recognitionRef.current = null
      }
    }
  }, [])

  const connect = useCallback(async () => {
    try {
      // Request microphone permission first
      await navigator.mediaDevices.getUserMedia({ audio: true })

      setIsConnected(true)
      addMessage('assistant', 'Connected! I\'m Bob, your AI assistant. Click the microphone to start speaking, or type your questions.')
    } catch (error) {
      console.error('Microphone access error:', error)
      addMessage('assistant', 'Could not access microphone. Please allow microphone access and try again.')
    }
  }, [addMessage])

  const disconnect = useCallback(async () => {
    if (recognitionRef.current) {
      isListeningRef.current = false
      recognitionRef.current.stop()
      recognitionRef.current = null
    }

    setIsConnected(false)
    setIsRecording(false)
    setInterimTranscript('')
    addMessage('assistant', 'Disconnected from the session.')
  }, [addMessage])

  const toggleVoice = useCallback(async () => {
    if (!isConnected) return

    if (isRecording) {
      // Stop recording
      isListeningRef.current = false
      if (recognitionRef.current) {
        recognitionRef.current.stop()
      }
      setIsRecording(false)
      setInterimTranscript('')
    } else {
      // Start recording
      if (!recognitionRef.current) {
        recognitionRef.current = initRecognition()
      }

      if (recognitionRef.current) {
        try {
          isListeningRef.current = true
          recognitionRef.current.start()
          setIsRecording(true)
        } catch (error) {
          console.error('Failed to start recognition:', error)
          // Try reinitializing
          recognitionRef.current = initRecognition()
          if (recognitionRef.current) {
            isListeningRef.current = true
            recognitionRef.current.start()
            setIsRecording(true)
          }
        }
      }
    }
  }, [isConnected, isRecording, initRecognition])

  const sendMessage = useCallback((content) => {
    addMessage('user', content)

    // TODO: Hook up to backend here
    // For now, just echo back for testing
    setTimeout(() => {
      addMessage('assistant', `[Local Mode] You said: "${content}"`)
    }, 500)
  }, [addMessage])

  return {
    isConnected,
    isRecording,
    messages,
    interimTranscript, // New: real-time speech transcription
    connect,
    disconnect,
    toggleVoice,
    sendMessage
  }
}
