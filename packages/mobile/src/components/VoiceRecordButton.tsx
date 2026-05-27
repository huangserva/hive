import { Pressable, StyleSheet, Text } from 'react-native'

interface VoiceRecordButtonProps {
  onTranscript: (text: string) => void
  disabled?: boolean
  transcribeVoice: (audioBase64: string, format?: string) => Promise<string | null>
}

export const VoiceRecordButton = ({ disabled = false }: VoiceRecordButtonProps) => {
  return (
    <Pressable
      accessibilityLabel="Voice recording (unavailable)"
      disabled={disabled}
      style={[styles.micButton, styles.micButtonDisabled]}
    >
      <Text style={styles.micIcon}>🎤</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
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
  micButtonDisabled: {
    opacity: 0.4,
  },
  micIcon: {
    color: '#e6edf3',
    fontSize: 18,
  },
})
