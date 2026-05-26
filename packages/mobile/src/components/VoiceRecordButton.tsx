import { Audio } from 'expo-av'
import * as FileSystem from 'expo-file-system'
import { useState } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native'

interface VoiceRecordButtonProps {
  onTranscript: (text: string) => void
  disabled?: boolean
  transcribeVoice: (audioBase64: string, format?: string) => Promise<string | null>
}

const MAX_DURATION_MS = 60_000

export const VoiceRecordButton = ({
  onTranscript,
  disabled = false,
  transcribeVoice,
}: VoiceRecordButtonProps) => {
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [recording, setRecording] = useState<Audio.Recording | null>(null)

  const startRecording = async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync()
      if (status !== 'granted') {
        Alert.alert('Microphone required', 'Please grant microphone permission to use voice input.')
        return
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      })
      const { recording: newRecording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
        undefined,
        MAX_DURATION_MS
      )
      setRecording(newRecording)
      setIsRecording(true)
    } catch {
      Alert.alert('Recording failed', 'Could not start recording.')
    }
  }

  const stopAndTranscribe = async () => {
    if (!recording) return
    setIsRecording(false)
    setIsTranscribing(true)
    try {
      await recording.stopAndUnloadAsync()
      const uri = recording.getURI()
      setRecording(null)
      if (!uri) {
        Alert.alert('Recording failed', 'No audio file produced.')
        return
      }
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      })
      const text = await transcribeVoice(base64, 'm4a')
      if (text) {
        onTranscript(text)
      }
    } catch {
      Alert.alert('Transcription failed', 'Could not transcribe audio.')
    } finally {
      setIsTranscribing(false)
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: false,
      })
    }
  }

  if (isTranscribing) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color="#58a6ff" size="small" />
        <Text style={styles.label}>Transcribing...</Text>
      </View>
    )
  }

  return (
    <Pressable
      accessibilityLabel="Hold to record voice"
      disabled={disabled}
      onLongPress={startRecording}
      onPressOut={() => {
        if (isRecording) void stopAndTranscribe()
      }}
      style={({ pressed }) => [
        styles.micButton,
        isRecording ? styles.micButtonActive : null,
        pressed && !isRecording ? styles.micButtonPressed : null,
        disabled ? styles.micButtonDisabled : null,
      ]}
    >
      <Text style={styles.micIcon}>{isRecording ? '⏺' : '🎤'}</Text>
      {isRecording ? <View style={styles.pulseDot} /> : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  label: {
    color: '#8b949e',
    fontSize: 13,
  },
  micButton: {
    alignItems: 'center',
    backgroundColor: '#21262d',
    borderColor: '#30363d',
    borderRadius: 20,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  micButtonActive: {
    backgroundColor: '#da3633',
    borderColor: '#ff7b72',
  },
  micButtonDisabled: {
    opacity: 0.4,
  },
  micButtonPressed: {
    borderColor: '#58a6ff',
    opacity: 0.8,
  },
  micIcon: {
    color: '#e6edf3',
    fontSize: 18,
  },
  pulseDot: {
    backgroundColor: '#ff7b72',
    borderRadius: 4,
    height: 8,
    position: 'absolute',
    right: 4,
    top: 4,
    width: 8,
  },
})
