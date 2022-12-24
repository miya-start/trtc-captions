import 'regenerator-runtime' // for the bug of react-speech-recognition
import { useEffect, useRef, useState } from 'react'
import SpeechRecognition, {
  useSpeechRecognition,
} from 'react-speech-recognition'
import { io, Socket } from 'socket.io-client'
import TRTC, { Client, LocalStream } from 'trtc-js-sdk'
import { genTestUserSig } from '../debug/GenerateTestUserSig'
import { Languages, Setting } from './Setting'
import '../style.css'

const Stream: React.FC = () => {
  return (
    <>
      <div id="localStreamContainer" />
      <div id="remoteStreamContainer" />
    </>
  )
}

type Transcript = { time: number; transcript: string }

type MessageToSend = {
  isTranscriptEnded: boolean
  language: Languages[number]['value']
  transcript: string
  time: number
  userId: string
}

type MessageReceived = MessageToSend & {
  translates: readonly (readonly [Languages, string])[]
}

const Captions: React.FC<{
  captionTexts: (Transcript | MessageReceived)[]
}> = ({ captionTexts: captions }) => {
  return (
    <div>
      {captions.map(({ time, transcript }) => (
        <div key={time}>{transcript}</div>
      ))}
    </div>
  )
}

function sendMessage(socket: Socket, message: Omit<MessageToSend, 'time'>) {
  socket.emit('send-message', { ...message, time: Date.now() })
}

const DELETION_INTERVAL = 2000
const App: React.FC = () => {
  const {
    browserSupportsSpeechRecognition,
    finalTranscript,
    listening,
    transcript,
  } = useSpeechRecognition()
  const [captionTexts, setCaptionTexts] = useState<MessageReceived[]>([])
  const [client, setClient] = useState<Client | null>(null)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [language, setLanguage] = useState<Languages[number]['value']>('ja')
  const [localStream, setLocalStream] = useState<LocalStream | null>(null)
  const [roomId, setRoomId] = useState(1)
  const [socket, setSocket] = useState<Socket | null>(null)
  const [transcripts, setTranscripts] = useState<Transcript[]>([])
  const [userId, setUserId] = useState('user1')
  const isTranscriptEndedRef = useRef(true)
  const transcriptWordsLengthRef = useRef(0)

  const handleTRTC = async () => {
    const { sdkAppId, userSig } = genTestUserSig(userId)
    const iclient = TRTC.createClient({
      mode: 'rtc',
      sdkAppId,
      userId,
      userSig,
    })
    setClient(iclient)
    iclient.on('stream-added', (event) => {
      const remoteStream = event.stream
      console.log('remote stream add streamId: ' + remoteStream.getId())
      iclient.subscribe(remoteStream)
    })
    iclient.on('stream-subscribed', (event) => {
      const remoteStream = event.stream
      remoteStream.play('remoteStreamContainer')
    })

    try {
      await iclient.join({ roomId })
      const localStream = TRTC.createStream({
        userId,
        audio: true,
        video: true,
      })
      await localStream.initialize()
      localStream.play('localStreamContainer')
      await iclient.publish(localStream)
      setLocalStream(localStream)
    } catch (error) {
      console.error(error)
    }
  }

  const handleSocket = () => {
    const isocket = io()
    setSocket(isocket)

    isocket.on('connect', () => {
      console.log('connected')
    })
    isocket.on('disconnect', () => {
      console.log('disconnected')
    })

    isocket.on('receive-message', (data: MessageReceived) => {
      console.log('receive-message', data)
      if (data.isTranscriptEnded) {
        return setCaptionTexts((prevs) => {
          return [...prevs, data]
        })
      }
      setCaptionTexts((prevs) => {
        const index = prevs.findLastIndex((prev) => {
          return prev.userId === data.userId
        })
        if (index === -1) return [...prevs, data]
        return [...prevs.slice(0, index), data, ...prevs.slice(index + 1)]
      })
    })
  }

  const handleSpeechRecognition = () => {
    if (!browserSupportsSpeechRecognition) {
      throw Error('browser does not support speech recognition')
    }
    SpeechRecognition.startListening()
  }

  const startCall = async () => {
    handleTRTC()
    handleSocket()
    handleSpeechRecognition()
  }

  const finishCall = async () => {
    if (!localStream) return
    if (!client || !socket) {
      throw Error('client or socket is null')
    }
    localStream.close()
    await client.leave()
    client.destroy()
    socket.disconnect()
    SpeechRecognition.stopListening()
  }

  useEffect(() => {
    if (localStream && deviceId) {
      localStream.switchDevice('video', deviceId)
    }
  }, [localStream?.hasVideo, deviceId])

  useEffect(() => {
    if (socket?.connected) {
      socket.emit('join-room', `${roomId}`)
      socket.emit('send-language', language)
    }
  }, [socket?.connected])

  useEffect(() => {
    if (!socket?.connected) return
    if (!transcript) {
      transcriptWordsLengthRef.current = 0
      return
    }
    const length = transcript.split(' ').length
    if (length === transcriptWordsLengthRef.current && !finalTranscript) {
      return
    }
    transcriptWordsLengthRef.current = length
    if (length === 1 && !finalTranscript) return

    sendMessage(socket, {
      isTranscriptEnded: isTranscriptEndedRef.current,
      language,
      transcript: finalTranscript
        ? finalTranscript
        : transcript.replace(/\s\S*$/, ''),
      userId,
    })

    if (finalTranscript) {
      isTranscriptEndedRef.current = true
    } else {
      isTranscriptEndedRef.current = false
    }
  }, [finalTranscript, socket?.connected, transcript])

  useEffect(() => {
    if (!localStream?.hasVideo) return
    if (listening && isTranscriptEndedRef.current && transcript) {
      setTranscripts((prev) => [...prev, { time: Date.now(), transcript }])
    } else if (listening && !isTranscriptEndedRef.current) {
      setTranscripts((prev) => [
        ...prev.slice(0, -1),
        { time: Date.now(), transcript },
      ])
    }
    SpeechRecognition.startListening()
  }, [listening, localStream?.hasVideo, transcript])

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (transcripts.length === 0) return
      const now = Date.now()
      setTranscripts((prev) =>
        prev.filter(({ time }) => now - time < DELETION_INTERVAL)
      )
    }, DELETION_INTERVAL)
    return () => clearTimeout(timeoutId)
  }, [transcript, transcripts.length])

  return (
    <>
      <Setting
        roomId={roomId}
        userId={userId}
        setLanguage={setLanguage}
        setRoomId={setRoomId}
        setUserId={setUserId}
        setDeviceId={setDeviceId}
        startCall={startCall}
        finishCall={finishCall}
      />
      <Stream />
      <Captions captionTexts={captionTexts} />
    </>
  )
}

export default App
