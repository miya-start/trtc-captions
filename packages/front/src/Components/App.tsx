import 'regenerator-runtime' // for the bug of react-speech-recognition
import { useEffect, useState } from 'react'
import SpeechRecognition, {
  useSpeechRecognition,
} from 'react-speech-recognition'
import TRTC, { Client, LocalStream } from 'trtc-js-sdk'
import { genTestUserSig } from '../debug/GenerateTestUserSig'
import { io, Socket } from 'socket.io-client'
import { Setting } from './Setting'
import '../style.css'

const Stream: React.FC = () => {
  return (
    <>
      <div id="localStreamContainer" />
      <div id="remoteStreamContainer" />
    </>
  )
}

type Transcripts = { time: number; transcript: string }[]

const Captions: React.FC<{ transcripts: Transcripts }> = ({
  transcripts: captions,
}) => {
  return (
    <div>
      {captions
        .filter(({ transcript }) => transcript)
        .map(({ time, transcript }) => (
          <div key={time}>{transcript}</div>
        ))}
    </div>
  )
}

const App: React.FC = () => {
  const [client, setClient] = useState<Client | null>(null)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [localStream, setLocalStream] = useState<LocalStream | null>(null)
  const [roomId, setRoomId] = useState(1)
  const [socket, setSocket] = useState<Socket | null>(null)
  const [userId, setUserId] = useState('user1')
  const [transcripts, setTranscripts] = useState<Transcripts>([])
  const { browserSupportsSpeechRecognition, listening, transcript } =
    useSpeechRecognition()

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

    isocket.on('receive-message', (data) => {
      console.log('receive-message', data)
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
      socket.emit('send-message', {
        userId,
        text: 'hello world',
      })
    }
  }, [socket?.connected])

  useEffect(() => {
    if (!localStream?.hasVideo) return
    if (transcript) {
      setTranscripts((prev) => [
        ...prev.slice(0, -1),
        { time: Date.now(), transcript },
      ])
    } else if (!transcript) {
      setTranscripts((prev) => [...prev, { time: Date.now(), transcript }])
    }
    SpeechRecognition.startListening()
  }, [listening, localStream?.hasVideo, transcript])

  useEffect(() => {
    const TIME = 2000
    const timeoutId = setTimeout(() => {
      if (transcripts.length === 0) return
      const now = Date.now()
      setTranscripts((prev) => prev.filter(({ time }) => now - time < TIME))
    }, TIME)
    return () => clearTimeout(timeoutId)
  }, [transcripts.length])

  return (
    <>
      <Setting
        roomId={roomId}
        userId={userId}
        setRoomId={setRoomId}
        setUserId={setUserId}
        setDeviceId={setDeviceId}
        startCall={startCall}
        finishCall={finishCall}
      />
      <Stream />
      <Captions transcripts={transcripts} />
    </>
  )
}

export default App
