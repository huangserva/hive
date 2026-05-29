import { Ionicons } from '@expo/vector-icons'
import type { ComponentProps } from 'react'
import { useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import { useMobileRuntime } from '../../src/api/mobile-runtime-context'
import { Screen } from '../../src/components/Screen'
import { colors, radius, spacing } from '../../src/theme'

type IconName = ComponentProps<typeof Ionicons>['name']

export default function SettingsTab() {
  const {
    connectionMode,
    connect,
    demoMode,
    disconnect,
    enableDemoMode,
    error,
    host,
    pairedDevice,
    relayConfig,
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

  const onConnectToken = async () => {
    const nextToken = draftToken.trim()
    if (!nextToken) {
      Alert.alert('Missing token', 'Create a permanent mobile token in HippoTeam Settings first.')
      return
    }
    setHost(draftHost)
    setToken(nextToken)
    const connected = await connect(draftHost, nextToken)
    if (connected) {
      Alert.alert('Connected', 'This device is connected with a permanent mobile token.')
    }
  }

  const onDisconnect = () => {
    Alert.alert('Disconnect device', 'Remove the saved mobile token from this app?', [
      { style: 'cancel', text: 'Cancel' },
      {
        onPress: () => {
          void disconnect()
        },
        style: 'destructive',
        text: 'Disconnect',
      },
    ])
  }

  const isConnected = state === 'connected'
  const lanAvailable = connectionMode === 'lan' || isConnected
  const deviceMeta = [
    pairedDevice?.device_type,
    formatDateLabel('Created', pairedDevice?.created_at),
    formatDateLabel('Last seen', pairedDevice?.last_seen_at),
  ]
    .filter(Boolean)
    .join(' • ')
  const deviceCapabilities = pairedDevice?.capabilities ?? []
  const relayMeta = relayConfig
    ? [relayConfig.relay_url, relayConfig.room_id ? `Room ${relayConfig.room_id}` : null]
        .filter(Boolean)
        .join(' • ')
    : null
  const lanMeta = [host || null, runtimeStatus?.port ? `Port ${runtimeStatus.port}` : null]
    .filter(Boolean)
    .join(' • ')

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
          <ConnectionBadge state={state} />
        </View>

        <SectionLabel>CONNECT TO ORCHESTRATOR</SectionLabel>
        <View style={styles.card}>
          <FieldHeader
            subtitle="The URL or IP address of your orchestrator."
            title="Orchestrator Host"
          />
          <View style={styles.inputShell}>
            <Ionicons color={colors.muted} name="link-outline" size={23} />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              inputMode="url"
              onChangeText={setDraftHost}
              placeholder="https://orchestrator.hippoteam.local"
              placeholderTextColor={colors.muted2}
              style={styles.input}
              value={draftHost}
            />
            {draftHost ? (
              <Pressable accessibilityRole="button" onPress={() => setDraftHost('')}>
                <Ionicons color={colors.muted} name="close-circle" size={22} />
              </Pressable>
            ) : null}
          </View>

          <FieldHeader
            subtitle="Paste the permanent mobile token created in HippoTeam Settings."
            title="Mobile Token"
          />
          <View style={styles.inputShell}>
            <Ionicons color={colors.muted} name="key-outline" size={23} />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setDraftToken}
              placeholder="Paste mobile token"
              placeholderTextColor={colors.muted2}
              secureTextEntry
              style={styles.input}
              value={draftToken}
            />
            {draftToken ? (
              <Pressable accessibilityRole="button" onPress={() => setDraftToken('')}>
                <Ionicons color={colors.muted} name="close-circle" size={22} />
              </Pressable>
            ) : null}
          </View>

          <Pressable
            accessibilityRole="button"
            disabled={state === 'checking'}
            onPress={onConnectToken}
            style={[styles.primaryButton, state === 'checking' ? styles.disabled : null]}
          >
            <Ionicons color={colors.background} name="lock-closed-outline" size={19} />
            <Text style={styles.primaryButtonText}>
              {state === 'checking' ? 'Connecting...' : 'Connect Device'}
            </Text>
          </Pressable>
          <Text style={styles.formHint}>
            Mobile tokens are permanent until deleted from HippoTeam Settings.
          </Text>
        </View>

        <SectionLabel>CONNECTED DEVICE</SectionLabel>
        <View style={styles.deviceCard}>
          <View style={styles.deviceHeader}>
            <View style={styles.deviceIcon}>
              <Ionicons color={colors.accent} name="laptop-outline" size={29} />
            </View>
            <View style={styles.deviceCopy}>
              <View style={styles.deviceTitleRow}>
                <Text numberOfLines={1} style={styles.deviceName}>
                  {pairedDevice?.name ?? 'Connected device'}
                </Text>
                <View style={styles.connectedBadge}>
                  <Text style={styles.connectedBadgeText}>
                    {isConnected ? 'Connected' : 'Not connected'}
                  </Text>
                </View>
              </View>
              {deviceMeta ? <Text style={styles.deviceMeta}>{deviceMeta}</Text> : null}
            </View>
            <Ionicons color={colors.muted} name="chevron-forward" size={22} />
          </View>
          {deviceCapabilities.length > 0 ? (
            <>
              <View style={styles.divider} />
              <Text style={styles.capabilitiesLabel}>Capabilities</Text>
              <View style={styles.capabilityRow}>
                {deviceCapabilities.map((capability) => (
                  <Capability key={capability} label={formatCapability(capability)} />
                ))}
              </View>
            </>
          ) : null}
          {isConnected || token.trim() ? (
            <Pressable accessibilityRole="button" onPress={onDisconnect} style={styles.disconnect}>
              <Ionicons color={colors.error} name="unlink-outline" size={19} />
              <Text style={styles.disconnectText}>Disconnect</Text>
            </Pressable>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>

        <SectionLabel>WORKSPACES</SectionLabel>
        <View style={styles.workspaceCard}>
          {workspaces.length === 0 ? (
            <Text style={styles.detail}>No workspaces loaded yet. Connect with a token first.</Text>
          ) : null}
          {workspaces.map((workspace) => (
            <Pressable
              accessibilityRole="button"
              key={workspace.id}
              onPress={() => void selectWorkspace(workspace.id)}
              style={styles.workspaceRow}
            >
              {selectedWorkspaceId === workspace.id ? (
                <View style={styles.selectedWorkspaceIcon}>
                  <Ionicons color={colors.background} name="checkmark" size={18} />
                </View>
              ) : (
                <View style={styles.workspaceIcon} />
              )}
              <View style={styles.workspaceText}>
                <Text style={styles.workspaceName}>{workspace.name}</Text>
                {selectedWorkspaceId === workspace.id ? (
                  <Text numberOfLines={1} style={styles.detail}>
                    Active workspace
                  </Text>
                ) : null}
              </View>
              <Ionicons color={colors.muted} name="chevron-forward" size={22} />
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" style={styles.addWorkspace}>
            <Ionicons color={colors.accent} name="add" size={20} />
            <Text style={styles.addWorkspaceText}>Add Workspace</Text>
          </Pressable>
        </View>

        <SectionLabel>CONNECTION DETAILS</SectionLabel>
        <View style={styles.connectionCard}>
          <ConnectionDetailRow
            icon="wifi-outline"
            meta={relayMeta}
            status={connectionMode === 'relay' ? 'Connected' : 'Disconnected'}
            title="Relay"
            tone={connectionMode === 'relay' ? 'success' : 'muted'}
          />
          <View style={styles.divider} />
          <ConnectionDetailRow
            icon="git-network-outline"
            meta={lanMeta || null}
            status={lanAvailable ? 'Available' : 'Unavailable'}
            title="LAN"
            tone={lanAvailable ? 'accent' : 'muted'}
          />
          {runtimeStatus ? (
            <Text style={styles.runtimeVersion}>
              Runtime version: {String(runtimeStatus.version ?? 'unknown')}
            </Text>
          ) : null}
        </View>

        {!demoMode ? (
          <Pressable accessibilityRole="button" onPress={enableDemoMode} style={styles.demoButton}>
            <Ionicons color={colors.accent} name="eye-outline" size={18} />
            <Text style={styles.demoButtonText}>Enable Demo Mode</Text>
            <Text style={styles.demoHint}>Preview all pages with sample data</Text>
          </Pressable>
        ) : (
          <View style={styles.demoActive}>
            <Ionicons color={colors.success} name="checkmark-circle" size={18} />
            <Text style={styles.demoActiveText}>Demo Mode Active</Text>
          </View>
        )}
      </ScrollView>
    </Screen>
  )
}

const SectionLabel = ({ children }: { children: string }) => (
  <Text style={styles.sectionLabel}>{children}</Text>
)

const FieldHeader = ({ subtitle, title }: { subtitle: string; title: string }) => (
  <View style={styles.fieldHeader}>
    <Text style={styles.fieldTitle}>{title}</Text>
    <Text style={styles.fieldSubtitle}>{subtitle}</Text>
  </View>
)

const formatDateLabel = (label: string, value?: string | null) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return `${label} ${new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)}`
}

const formatCapability = (capability: string) =>
  capability
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')

const Capability = ({ icon, label }: { icon?: IconName; label: string }) => (
  <View style={styles.capabilityChip}>
    {icon ? <Ionicons color={colors.accent} name={icon} size={16} /> : null}
    <Text style={styles.capabilityText}>{label}</Text>
  </View>
)

const ConnectionDetailRow = ({
  icon,
  meta,
  status,
  title,
  tone,
}: {
  icon: IconName
  meta: string | null
  status: string
  title: string
  tone: 'accent' | 'muted' | 'success'
}) => {
  const toneColor =
    tone === 'success' ? colors.success : tone === 'accent' ? colors.accent : colors.muted
  return (
    <View style={styles.connectionDetailRow}>
      <View style={[styles.connectionIcon, { backgroundColor: `${toneColor}18` }]}>
        <Ionicons color={toneColor} name={icon} size={23} />
      </View>
      <View style={styles.connectionDetailCopy}>
        <View style={styles.connectionTitleRow}>
          <Text style={styles.connectionDetailTitle}>{title}</Text>
          <View style={[styles.statusPill, { backgroundColor: `${toneColor}18` }]}>
            <Text style={[styles.statusPillText, { color: toneColor }]}>{status}</Text>
          </View>
        </View>
        {meta ? <Text style={styles.connectionMeta}>{meta}</Text> : null}
      </View>
      <Ionicons color={colors.muted} name="chevron-forward" size={22} />
    </View>
  )
}

const ConnectionBadge = ({ state }: { state: 'idle' | 'checking' | 'connected' | 'error' }) => {
  const isConnected = state === 'connected'
  return (
    <View style={[styles.badge, isConnected ? styles.badgeConnected : styles.badgeIdle]}>
      <Text style={styles.badgeText}>{isConnected ? 'Orchestrator Online' : state}</Text>
      <View
        style={[styles.badgeDot, isConnected ? styles.badgeDotConnected : styles.badgeDotIdle]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  addWorkspace: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.sm,
  },
  addWorkspaceText: { color: colors.accent, fontSize: 16, fontWeight: '700' },
  badge: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  badgeConnected: {
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
  },
  badgeDot: {
    borderRadius: 999,
    height: 9,
    width: 9,
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
    color: colors.textSoft,
    fontSize: 13,
    fontWeight: '700',
  },
  capabilityChip: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  capabilityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  capabilitiesLabel: { color: colors.textSoft, fontSize: 13, fontWeight: '700' },
  capabilityText: { color: colors.textSoft, fontSize: 13, fontWeight: '700' },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  codeInput: {
    color: colors.text,
    flex: 1,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 4,
    paddingVertical: 10,
  },
  connectedBadge: {
    backgroundColor: colors.successSoft,
    borderColor: 'rgba(63, 185, 80, 0.34)',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  connectedBadgeText: { color: colors.success, fontSize: 13, fontWeight: '800' },
  connectionCard: {
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
  },
  connectionDetailCopy: { flex: 1, gap: 3 },
  connectionDetailRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  connectionDetailTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  connectionIcon: {
    alignItems: 'center',
    borderRadius: radius.sm,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  connectionMeta: { color: colors.muted, fontSize: 14 },
  connectionTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  detail: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 19,
  },
  deviceCard: {
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  deviceCopy: { flex: 1, gap: 5 },
  deviceHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  deviceIcon: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderColor: 'rgba(88, 166, 255, 0.24)',
    borderRadius: radius.md,
    borderWidth: 1,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  deviceMeta: { color: colors.muted, fontSize: 15 },
  deviceName: { color: colors.text, flexShrink: 1, fontSize: 18, fontWeight: '900' },
  deviceTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  disabled: {
    opacity: 0.6,
  },
  disconnect: {
    alignItems: 'center',
    borderColor: colors.error,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    marginTop: spacing.xs,
    paddingVertical: 13,
  },
  disconnectText: {
    color: colors.error,
    fontSize: 16,
    fontWeight: '800',
  },
  divider: { backgroundColor: colors.borderMuted, height: 1 },
  error: {
    color: colors.error,
    fontSize: 13,
  },
  fieldHeader: { gap: 4 },
  fieldSubtitle: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  fieldTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  formHint: { color: colors.muted, fontSize: 14 },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  input: {
    color: colors.text,
    flex: 1,
    fontSize: 16,
    paddingVertical: 10,
  },
  inputShell: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: 14,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: colors.background,
    fontSize: 17,
    fontWeight: '900',
  },
  runtimeVersion: { color: colors.muted2, fontSize: 12, marginTop: spacing.xs },
  scroll: {
    gap: spacing.sm,
    paddingBottom: spacing.lg,
  },
  sectionLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginTop: spacing.sm,
  },
  selectedWorkspaceIcon: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  statusPillText: { fontSize: 12, fontWeight: '800' },
  title: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '900',
  },
  workspaceCard: {
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
  },
  workspaceIcon: {
    borderColor: colors.borderMuted,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 32,
    width: 32,
  },
  workspaceName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  workspaceRow: {
    alignItems: 'center',
    borderBottomColor: colors.borderMuted,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  workspaceText: {
    flex: 1,
    gap: 3,
  },
  demoButton: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.accentSoft,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: 4,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  demoButtonText: {
    color: colors.accent,
    fontSize: 16,
    fontWeight: '800',
  },
  demoHint: {
    color: colors.muted,
    fontSize: 13,
  },
  demoActive: {
    alignItems: 'center',
    backgroundColor: colors.successSoft,
    borderColor: 'rgba(63, 185, 80, 0.34)',
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
  },
  demoActiveText: {
    color: colors.success,
    fontSize: 15,
    fontWeight: '800',
  },
})
