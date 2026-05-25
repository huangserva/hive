import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import { useMobileRuntime } from '../../src/api/mobile-runtime-context'
import { Screen } from '../../src/components/Screen'

export default function SettingsTab() {
  const {
    connect,
    error,
    host,
    pairHost,
    runtimeStatus,
    selectWorkspace,
    selectedWorkspaceId,
    setHost,
    setToken,
    state,
    token,
    workspaces,
  } = useMobileRuntime()
  const [draftHost, setDraftHost] = useState(host)
  const [draftToken, setDraftToken] = useState(token)

  useEffect(() => {
    setDraftHost(host)
  }, [host])

  useEffect(() => {
    setDraftToken(token)
  }, [token])

  const onConnect = () => {
    setHost(draftHost)
    setToken(draftToken)
    void connect(draftHost, draftToken)
  }

  const onPair = async () => {
    setHost(draftHost)
    const pair = await pairHost(draftHost)
    if (pair) setDraftToken(pair.token)
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
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
        <Text style={styles.hint}>
          Pairing requires localhost. On device, open /api/mobile/pair on the computer and paste the
          token below.
        </Text>

        <Text style={styles.label}>Mobile token</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setDraftToken}
          placeholder="Paste token from /api/mobile/pair"
          placeholderTextColor="#6e7681"
          secureTextEntry
          style={styles.input}
          value={draftToken}
        />

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={state === 'checking'}
            onPress={onPair}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed || state === 'checking' ? styles.buttonPressed : null,
            ]}
          >
            <Text style={styles.buttonText}>Fetch pair token</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={state === 'checking'}
            onPress={onConnect}
            style={({ pressed }) => [
              styles.button,
              pressed || state === 'checking' ? styles.buttonPressed : null,
            ]}
          >
            <Text style={styles.buttonText}>
              {state === 'checking' ? 'Connecting...' : 'Connect'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.status}>Status: {state}</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {runtimeStatus ? (
            <>
              <Text style={styles.detail}>
                Version: {String(runtimeStatus.version ?? 'unknown')}
              </Text>
              <Text style={styles.detail}>cwd: {String(runtimeStatus.cwd ?? 'unknown')}</Text>
            </>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.status}>Workspaces</Text>
          {workspaces.length === 0 ? <Text style={styles.detail}>No workspaces loaded</Text> : null}
          {workspaces.map((workspace) => (
            <Pressable
              accessibilityRole="button"
              key={workspace.id}
              onPress={() => void selectWorkspace(workspace.id)}
              style={[
                styles.workspaceRow,
                selectedWorkspaceId === workspace.id ? styles.workspaceRowSelected : null,
              ]}
            >
              <Text style={styles.workspaceName}>{workspace.name}</Text>
              <Text style={styles.detail}>{workspace.path}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
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
  hint: {
    color: '#8b949e',
    fontSize: 13,
    lineHeight: 19,
  },
  scroll: {
    gap: 16,
    paddingBottom: 24,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#30363d',
    borderRadius: 10,
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
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
  workspaceName: {
    color: '#e6edf3',
    fontSize: 15,
    fontWeight: '700',
  },
  workspaceRow: {
    borderColor: '#30363d',
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
    padding: 12,
  },
  workspaceRowSelected: {
    borderColor: '#58a6ff',
  },
})
