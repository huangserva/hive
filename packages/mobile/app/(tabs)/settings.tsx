import { Ionicons } from '@expo/vector-icons'
import { useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import { useMobileRuntime } from '../../src/api/mobile-runtime-context'
import { Screen } from '../../src/components/Screen'
import { colors, radius, spacing } from '../../src/theme'

export default function SettingsTab() {
  const {
    connect,
    connectionMode,
    disconnect,
    error,
    host,
    pairHost,
    pairedDevice,
    relayConfig,
    redeemPairingCode,
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
  const [draftPairingCode, setDraftPairingCode] = useState('')
  const [draftToken, setDraftToken] = useState(token)
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => {
    setDraftHost(host)
  }, [host])

  useEffect(() => {
    setDraftToken(token)
  }, [token])

  const onPairCode = async () => {
    const code = draftPairingCode.replace(/\D/g, '')
    if (code.length !== 6) {
      Alert.alert('Invalid code', 'Enter the 6 digit pairing code shown in HippoTeam.')
      return
    }
    setHost(draftHost)
    const redeemed = await redeemPairingCode(draftHost, code)
    if (redeemed) {
      setDraftToken(redeemed.token)
      setDraftPairingCode('')
      Alert.alert('Paired', `Connected as ${redeemed.device.name}`)
    }
  }

  const onConnect = () => {
    setHost(draftHost)
    setToken(draftToken)
    void connect(draftHost, draftToken)
  }

  const onFetchLegacyToken = async () => {
    setHost(draftHost)
    const pair = await pairHost(draftHost)
    if (pair) setDraftToken(pair.token)
  }

  const onDisconnect = () => {
    Alert.alert('Disconnect device', 'Remove the saved mobile token from this app?', [
      { style: 'cancel', text: 'Cancel' },
      {
        onPress: () => {
          setDraftToken('')
          void disconnect()
        },
        style: 'destructive',
        text: 'Disconnect',
      },
    ])
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>Device setup</Text>
            <Text style={styles.title}>Settings</Text>
          </View>
          <ConnectionBadge mode={connectionMode} state={state} />
        </View>

        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <Ionicons color={colors.accent} name="lock-closed-outline" size={22} />
          </View>
          <View style={styles.heroText}>
            <Text style={styles.heroTitle}>Pair with your desktop runtime</Text>
            <Text style={styles.heroBody}>
              Generate a pairing code in HippoTeam on your computer, then enter it here from the
              same network.
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Runtime host</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            inputMode="url"
            onChangeText={setDraftHost}
            placeholder="192.168.1.100:4010"
            placeholderTextColor={colors.muted2}
            style={styles.input}
            value={draftHost}
          />

          <Text style={styles.label}>Pairing code</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            inputMode="numeric"
            keyboardType="number-pad"
            maxLength={6}
            onChangeText={(value) => setDraftPairingCode(value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            placeholderTextColor={colors.muted2}
            style={styles.codeInput}
            value={draftPairingCode}
          />

          <Pressable
            accessibilityRole="button"
            disabled={state === 'checking'}
            onPress={onPairCode}
            style={[styles.primaryButton, state === 'checking' ? styles.disabled : null]}
          >
            <Text style={styles.primaryButtonText}>
              {state === 'checking' ? 'Pairing...' : 'Pair'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <Ionicons
              color={state === 'connected' ? colors.success : colors.warning}
              name={state === 'connected' ? 'checkmark-circle-outline' : 'alert-circle-outline'}
              size={20}
            />
            <View style={styles.statusText}>
              <Text style={styles.statusTitle}>Runtime {state}</Text>
              <Text style={styles.statusMeta}>Connection: {connectionMode.toUpperCase()}</Text>
            </View>
          </View>
          {relayConfig ? <Text style={styles.detail}>Relay: {relayConfig.relay_url}</Text> : null}
          {pairedDevice ? <Text style={styles.detail}>Device: {pairedDevice.name}</Text> : null}
          {runtimeStatus ? (
            <>
              <Text style={styles.detail}>
                Version: {String(runtimeStatus.version ?? 'unknown')}
              </Text>
              <Text style={styles.detail}>cwd: {String(runtimeStatus.cwd ?? 'unknown')}</Text>
            </>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {token ? (
            <Pressable accessibilityRole="button" onPress={onDisconnect} style={styles.disconnect}>
              <Text style={styles.disconnectText}>Disconnect this device</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.sectionTitle}>Workspace</Text>
            <Text style={styles.sectionMeta}>{workspaces.length} available</Text>
          </View>
          {workspaces.length === 0 ? (
            <Text style={styles.detail}>No workspaces loaded yet. Pair or connect first.</Text>
          ) : null}
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
              <View style={styles.workspaceIcon}>
                <Text style={styles.workspaceInitial}>{workspace.name.slice(0, 1)}</Text>
              </View>
              <View style={styles.workspaceText}>
                <Text style={styles.workspaceName}>{workspace.name}</Text>
                <Text numberOfLines={1} style={styles.detail}>
                  {workspace.path}
                </Text>
              </View>
              {selectedWorkspaceId === workspace.id ? (
                <Ionicons color={colors.success} name="checkmark-circle" size={20} />
              ) : null}
            </Pressable>
          ))}
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => setShowAdvanced((value) => !value)}
          style={styles.advancedToggle}
        >
          <Text style={styles.advancedToggleText}>
            {showAdvanced ? 'Hide advanced token fallback' : 'Advanced token fallback'}
          </Text>
        </Pressable>

        {showAdvanced ? (
          <View style={styles.card}>
            <Text style={styles.label}>Mobile token</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setDraftToken}
              placeholder="Paste token"
              placeholderTextColor={colors.muted2}
              secureTextEntry
              style={styles.input}
              value={draftToken}
            />
            <View style={styles.advancedActions}>
              <Pressable
                accessibilityRole="button"
                disabled={state === 'checking'}
                onPress={onFetchLegacyToken}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryButtonText}>Fetch legacy</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={state === 'checking'}
                onPress={onConnect}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryButtonText}>Connect</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  )
}

const ConnectionBadge = ({
  mode,
  state,
}: {
  mode: string
  state: 'idle' | 'checking' | 'connected' | 'error'
}) => {
  const isConnected = state === 'connected'
  return (
    <View style={[styles.badge, isConnected ? styles.badgeConnected : styles.badgeIdle]}>
      <View
        style={[styles.badgeDot, isConnected ? styles.badgeDotConnected : styles.badgeDotIdle]}
      />
      <Text style={styles.badgeText}>{isConnected ? mode.toUpperCase() : state}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  advancedActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  advancedToggle: {
    alignSelf: 'flex-start',
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  advancedToggleText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '800',
  },
  badge: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  badgeConnected: {
    backgroundColor: colors.successSoft,
    borderColor: 'rgba(63, 185, 80, 0.34)',
  },
  badgeDot: {
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  badgeDotConnected: {
    backgroundColor: colors.success,
  },
  badgeDotIdle: {
    backgroundColor: colors.warning,
  },
  badgeIdle: {
    backgroundColor: colors.warningSoft,
    borderColor: 'rgba(210, 153, 34, 0.34)',
  },
  badgeText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  codeInput: {
    backgroundColor: colors.background,
    borderColor: colors.accent,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 7,
    paddingHorizontal: 18,
    paddingVertical: 14,
    textAlign: 'center',
  },
  detail: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  disabled: {
    opacity: 0.6,
  },
  disconnect: {
    alignItems: 'center',
    borderColor: 'rgba(248, 81, 73, 0.34)',
    borderRadius: radius.sm,
    borderWidth: 1,
    marginTop: spacing.xs,
    paddingVertical: 11,
  },
  disconnectText: {
    color: colors.error,
    fontSize: 14,
    fontWeight: '800',
  },
  error: {
    color: colors.error,
    fontSize: 13,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  heroBody: {
    color: colors.textSoft,
    fontSize: 14,
    lineHeight: 20,
  },
  heroCard: {
    alignItems: 'flex-start',
    backgroundColor: colors.cardElevated,
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  heroIcon: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderRadius: radius.sm,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  heroText: {
    flex: 1,
    gap: 5,
  },
  heroTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  input: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 13,
  },
  primaryButtonText: {
    color: colors.background,
    fontSize: 15,
    fontWeight: '900',
  },
  scroll: {
    gap: spacing.sm,
    paddingBottom: spacing.lg,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 11,
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  sectionMeta: {
    color: colors.muted,
    fontSize: 13,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  statusCard: {
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  statusMeta: {
    color: colors.muted,
    fontSize: 13,
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statusText: {
    flex: 1,
    gap: 2,
  },
  statusTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '900',
  },
  workspaceIcon: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderRadius: radius.sm,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  workspaceInitial: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  workspaceName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  workspaceRow: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  workspaceRowSelected: {
    borderColor: colors.accent,
  },
  workspaceText: {
    flex: 1,
    gap: 3,
  },
})
