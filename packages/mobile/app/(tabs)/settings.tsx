import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { useRuntimeStatus } from '../../src/api/use-runtime-status'
import { Screen } from '../../src/components/Screen'

export default function SettingsTab() {
  const { connect, error, host, setHost, state, status } = useRuntimeStatus()
  const [draftHost, setDraftHost] = useState(host)

  useEffect(() => {
    setDraftHost(host)
  }, [host])

  const onConnect = () => {
    setHost(draftHost)
    void connect(draftHost)
  }

  return (
    <Screen>
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.label}>Runtime host</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        inputMode="url"
        onChangeText={setDraftHost}
        placeholder="192.168.1.100:4010"
        placeholderTextColor="#6e7681"
        style={styles.input}
        value={draftHost}
      />
      <Pressable
        accessibilityRole="button"
        disabled={state === 'checking'}
        onPress={onConnect}
        style={({ pressed }) => [
          styles.button,
          pressed || state === 'checking' ? styles.buttonPressed : null,
        ]}
      >
        <Text style={styles.buttonText}>{state === 'checking' ? 'Connecting...' : 'Connect'}</Text>
      </Pressable>

      <View style={styles.card}>
        <Text style={styles.status}>Status: {state}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {status ? (
          <>
            <Text style={styles.detail}>Version: {String(status.version ?? 'unknown')}</Text>
            <Text style={styles.detail}>cwd: {String(status.cwd ?? 'unknown')}</Text>
          </>
        ) : null}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: '#238636',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  buttonPressed: {
    opacity: 0.75,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#161b22',
    borderColor: '#30363d',
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  detail: {
    color: '#8b949e',
    fontSize: 14,
  },
  error: {
    color: '#ff7b72',
    fontSize: 14,
  },
  input: {
    backgroundColor: '#0d1117',
    borderColor: '#30363d',
    borderRadius: 10,
    borderWidth: 1,
    color: '#e6edf3',
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  label: {
    color: '#8b949e',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  status: {
    color: '#e6edf3',
    fontSize: 15,
    fontWeight: '700',
  },
  title: {
    color: '#e6edf3',
    fontSize: 26,
    fontWeight: '700',
  },
})
