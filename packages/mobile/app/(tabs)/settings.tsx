import { Ionicons } from '@expo/vector-icons'
import { type BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera'
import Constants from 'expo-constants'
import type { ComponentProps } from 'react'
import { useEffect, useState } from 'react'
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

import { useMobileRuntime } from '../../src/api/mobile-runtime-context'
import { Screen } from '../../src/components/Screen'
import { type TFunction, useLanguage, useT } from '../../src/i18n'
import { colors, radius, spacing } from '../../src/theme'

type IconName = ComponentProps<typeof Ionicons>['name']

export default function SettingsTab() {
  const { language, setLanguage } = useLanguage()
  const t = useT()
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
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scanLocked, setScanLocked] = useState(false)

  useEffect(() => {
    setDraftHost(host)
  }, [host])

  useEffect(() => {
    setDraftToken(token)
  }, [token])

  const onConnectToken = async () => {
    const nextToken = draftToken.trim()
    if (!nextToken) {
      Alert.alert(t('settings.missingTokenTitle'), t('settings.connectBody'))
      return
    }
    setHost(draftHost)
    setToken(nextToken)
    const connected = await connect(draftHost, nextToken)
    if (connected) {
      Alert.alert(t('common.connected'), t('settings.connectedBody'))
    }
  }

  const onOpenScanner = async () => {
    const permission = cameraPermission?.granted
      ? cameraPermission
      : await requestCameraPermission()
    if (!permission.granted) {
      Alert.alert(t('settings.cameraPermissionTitle'), t('settings.cameraPermissionBody'))
      return
    }
    setScanLocked(false)
    setScannerOpen(true)
  }

  const onBarcodeScanned = async (result: BarcodeScanningResult) => {
    if (scanLocked) return
    setScanLocked(true)
    const payload = parseConnectionQr(result.data)
    if (!payload) {
      setScannerOpen(false)
      Alert.alert(t('settings.invalidQrTitle'), t('settings.invalidQrBody'))
      return
    }
    setScannerOpen(false)
    setDraftHost(payload.host)
    setDraftToken(payload.token)
    setHost(payload.host)
    setToken(payload.token)
    const connected = await connect(payload.host, payload.token)
    if (connected) {
      Alert.alert(t('common.connected'), t('settings.connectedFromQr'))
    }
  }

  const onDisconnect = () => {
    Alert.alert(t('settings.deviceDisconnectTitle'), t('settings.deviceDisconnectBody'), [
      { style: 'cancel', text: t('common.cancel') },
      {
        onPress: () => {
          void disconnect()
        },
        style: 'destructive',
        text: t('settings.deviceDisconnect'),
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
  const appBuildLabel = getAppBuildLabel(t)

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('settings.title')}</Text>
          <ConnectionBadge state={state} />
        </View>

        <SectionLabel>{t('settings.appLanguageTitle')}</SectionLabel>
        <View style={styles.card}>
          <FieldHeader subtitle={t('settings.appLanguageHint')} title={t('settings.appLanguage')} />
          <View style={styles.languageToggle}>
            {(['en', 'zh'] as const).map((option) => {
              const active = language === option
              return (
                <Pressable
                  accessibilityRole="button"
                  key={option}
                  onPress={() => void setLanguage(option)}
                  style={[styles.languageOption, active && styles.languageOptionActive]}
                >
                  <Text
                    style={[styles.languageOptionText, active && styles.languageOptionTextActive]}
                  >
                    {option === 'en' ? 'English' : '中文'}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </View>

        <SectionLabel>{t('settings.connectSection')}</SectionLabel>
        <View style={styles.card}>
          <Pressable accessibilityRole="button" onPress={onOpenScanner} style={styles.scanButton}>
            <Ionicons color={colors.accent} name="qr-code-outline" size={21} />
            <View style={styles.scanButtonCopy}>
              <Text style={styles.scanButtonText}>{t('settings.scanQr')}</Text>
              <Text style={styles.scanButtonHint}>{t('settings.qrHint')}</Text>
            </View>
            <Ionicons color={colors.muted} name="chevron-forward" size={21} />
          </Pressable>

          <FieldHeader
            subtitle={t('settings.connectHostHint')}
            title={t('settings.connectHostTitle')}
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
            subtitle={t('settings.connectTokenHint')}
            title={t('settings.connectTokenTitle')}
          />
          <View style={styles.inputShell}>
            <Ionicons color={colors.muted} name="key-outline" size={23} />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setDraftToken}
              placeholder={t('settings.connectTokenPlaceholder')}
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
              {state === 'checking'
                ? `${t('chat.status.connecting')}...`
                : t('settings.connectToken')}
            </Text>
          </Pressable>
          <Text style={styles.formHint}>{t('settings.connectTokenHint')}</Text>
        </View>

        <SectionLabel>{t('settings.connectedDevice')}</SectionLabel>
        <View style={styles.deviceCard}>
          <View style={styles.deviceHeader}>
            <View style={styles.deviceIcon}>
              <Ionicons color={colors.accent} name="laptop-outline" size={29} />
            </View>
            <View style={styles.deviceCopy}>
              <View style={styles.deviceTitleRow}>
                <Text numberOfLines={1} style={styles.deviceName}>
                  {pairedDevice?.name ?? t('settings.deviceDefaultName')}
                </Text>
                <View style={styles.connectedBadge}>
                  <Text style={styles.connectedBadgeText}>
                    {isConnected ? t('settings.deviceConnected') : t('settings.deviceNotConnected')}
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
              <Text style={styles.capabilitiesLabel}>{t('settings.capabilities')}</Text>
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
              <Text style={styles.disconnectText}>{t('settings.deviceDisconnect')}</Text>
            </Pressable>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>

        <SectionLabel>{t('settings.workspaces')}</SectionLabel>
        <View style={styles.workspaceCard}>
          {workspaces.length === 0 ? (
            <Text style={styles.detail}>{t('settings.noWorkspaces')}</Text>
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
                    {t('settings.workspaceActive')}
                  </Text>
                ) : null}
              </View>
              <Ionicons color={colors.muted} name="chevron-forward" size={22} />
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" style={styles.addWorkspace}>
            <Ionicons color={colors.accent} name="add" size={20} />
            <Text style={styles.addWorkspaceText}>{t('settings.addWorkspace')}</Text>
          </Pressable>
        </View>

        <SectionLabel>{t('settings.connectionDetails')}</SectionLabel>
        <View style={styles.connectionCard}>
          <ConnectionDetailRow
            icon="wifi-outline"
            meta={relayMeta}
            status={connectionMode === 'relay' ? t('common.connected') : t('common.disconnected')}
            title={t('settings.relay')}
            tone={connectionMode === 'relay' ? 'success' : 'muted'}
          />
          <View style={styles.divider} />
          <ConnectionDetailRow
            icon="git-network-outline"
            meta={lanMeta || null}
            status={lanAvailable ? t('common.available') : t('common.unavailable')}
            title={t('settings.lan')}
            tone={lanAvailable ? 'accent' : 'muted'}
          />
          {runtimeStatus ? (
            <Text style={styles.runtimeVersion}>
              {t('settings.runtimeVersion', {
                version: String(runtimeStatus.version ?? t('common.unknown')),
              })}
            </Text>
          ) : null}
          <Text style={styles.runtimeVersion}>{appBuildLabel}</Text>
        </View>

        {!demoMode ? (
          <Pressable accessibilityRole="button" onPress={enableDemoMode} style={styles.demoButton}>
            <Ionicons color={colors.accent} name="eye-outline" size={18} />
            <Text style={styles.demoButtonText}>{t('settings.demoMode')}</Text>
            <Text style={styles.demoHint}>{t('settings.demoHint')}</Text>
          </Pressable>
        ) : (
          <View style={styles.demoActive}>
            <Ionicons color={colors.success} name="checkmark-circle" size={18} />
            <Text style={styles.demoActiveText}>{t('settings.demoActive')}</Text>
          </View>
        )}
      </ScrollView>

      <Modal
        animationType="slide"
        visible={scannerOpen}
        onRequestClose={() => setScannerOpen(false)}
      >
        <View style={styles.scannerScreen}>
          <View style={styles.scannerHeader}>
            <View>
              <Text style={styles.scannerTitle}>{t('settings.scanQrTitle')}</Text>
              <Text style={styles.scannerSubtitle}>{t('settings.scanQrSubtitle')}</Text>
            </View>
            <Pressable
              accessibilityLabel={t('settings.closeScanner')}
              accessibilityRole="button"
              onPress={() => setScannerOpen(false)}
              style={styles.scannerClose}
            >
              <Ionicons color={colors.text} name="close" size={24} />
            </Pressable>
          </View>
          <CameraView
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={scanLocked ? undefined : onBarcodeScanned}
            style={styles.camera}
          >
            <View style={styles.scanFrame} />
          </CameraView>
        </View>
      </Modal>
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

const getAppBuildLabel = (t: TFunction) => {
  const extra = Constants.expoConfig?.extra as
    | { buildSha?: unknown; buildTime?: unknown }
    | undefined
  const version = Constants.expoConfig?.version ?? 'unknown'
  const buildSha =
    typeof extra?.buildSha === 'string' && extra.buildSha ? extra.buildSha : 'unknown'
  const buildTime =
    typeof extra?.buildTime === 'string' && extra.buildTime
      ? formatBuildTime(extra.buildTime)
      : 'unknown time'
  return t('settings.appBuild', { sha: buildSha, time: buildTime, version })
}

const formatBuildTime = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'unknown time'
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

const formatCapability = (capability: string) =>
  capability
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')

const parseConnectionQr = (raw: string): { host: string; token: string } | null => {
  const fromObject = (value: unknown) => {
    if (!value || typeof value !== 'object') return null
    const candidate = value as { host?: unknown; token?: unknown }
    if (typeof candidate.host !== 'string' || typeof candidate.token !== 'string') return null
    const host = candidate.host.trim()
    const token = candidate.token.trim()
    return host && token ? { host, token } : null
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    const payload = fromObject(parsed)
    if (payload) return payload
  } catch {}

  try {
    const url = new URL(raw)
    const host = url.searchParams.get('host')?.trim()
    const token = url.searchParams.get('token')?.trim()
    return host && token ? { host, token } : null
  } catch {
    return null
  }
}

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
    gap: 6,
    paddingHorizontal: 6,
    paddingTop: 10,
  },
  addWorkspaceText: { color: colors.accent, fontSize: 14, fontWeight: '700' },
  badge: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeConnected: {
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
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
    color: colors.textSoft,
    fontSize: 12,
    fontWeight: '700',
  },
  capabilityChip: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  capabilityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  capabilitiesLabel: { color: colors.textSoft, fontSize: 12, fontWeight: '700' },
  capabilityText: { color: colors.textSoft, fontSize: 12, fontWeight: '700' },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: 10,
    padding: spacing.sm,
  },
  codeInput: {
    color: colors.text,
    flex: 1,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 4,
    paddingVertical: 8,
  },
  connectedBadge: {
    backgroundColor: colors.successSoft,
    borderColor: 'rgba(63, 185, 80, 0.34)',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  connectedBadgeText: { color: colors.success, fontSize: 12, fontWeight: '800' },
  connectionCard: {
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.sm,
  },
  connectionDetailCopy: { flex: 1, gap: 2 },
  connectionDetailRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 7,
  },
  connectionDetailTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  connectionIcon: {
    alignItems: 'center',
    borderRadius: radius.sm,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  connectionMeta: { color: colors.muted, fontSize: 13 },
  connectionTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  detail: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  deviceCard: {
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: 10,
    padding: spacing.sm,
  },
  deviceCopy: { flex: 1, gap: 4 },
  deviceHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  deviceIcon: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderColor: 'rgba(88, 166, 255, 0.24)',
    borderRadius: radius.md,
    borderWidth: 1,
    height: 54,
    justifyContent: 'center',
    width: 54,
  },
  deviceMeta: { color: colors.muted, fontSize: 13 },
  deviceName: { color: colors.text, flexShrink: 1, fontSize: 16, fontWeight: '900' },
  deviceTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
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
    gap: 7,
    justifyContent: 'center',
    marginTop: 6,
    paddingVertical: 11,
  },
  disconnectText: {
    color: colors.error,
    fontSize: 15,
    fontWeight: '800',
  },
  divider: { backgroundColor: colors.borderMuted, height: 1 },
  error: {
    color: colors.error,
    fontSize: 12,
  },
  fieldHeader: { gap: 3 },
  fieldSubtitle: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  fieldTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  formHint: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  input: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    paddingVertical: 8,
  },
  inputShell: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
  },
  languageOption: {
    alignItems: 'center',
    borderRadius: radius.sm,
    flex: 1,
    minHeight: 40,
    justifyContent: 'center',
    paddingVertical: 9,
  },
  languageOptionActive: {
    backgroundColor: colors.accent,
  },
  languageOptionText: {
    color: colors.textSoft,
    fontSize: 13,
    fontWeight: '800',
  },
  languageOptionTextActive: {
    color: colors.background,
  },
  languageToggle: {
    backgroundColor: colors.background,
    borderColor: colors.borderMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: colors.background,
    fontSize: 15,
    fontWeight: '900',
  },
  camera: {
    flex: 1,
  },
  runtimeVersion: { color: colors.muted2, fontSize: 11, marginTop: 6 },
  scanButton: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderColor: 'rgba(88, 166, 255, 0.24)',
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 10,
  },
  scanButtonCopy: {
    flex: 1,
    gap: 3,
  },
  scanButtonHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  scanButtonText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '900',
  },
  scanFrame: {
    alignSelf: 'center',
    borderColor: colors.accent,
    borderRadius: radius.lg,
    borderWidth: 3,
    height: 240,
    marginTop: 160,
    width: 240,
  },
  scannerClose: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: 999,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  scannerHeader: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: 56,
  },
  scannerScreen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scannerSubtitle: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 4,
  },
  scannerTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
  },
  scroll: {
    gap: 9,
    paddingBottom: spacing.lg,
  },
  sectionLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginTop: 10,
  },
  selectedWorkspaceIcon: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusPillText: { fontSize: 11, fontWeight: '800' },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '900',
  },
  workspaceCard: {
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.sm,
  },
  workspaceIcon: {
    borderColor: colors.borderMuted,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 28,
    width: 28,
  },
  workspaceName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  workspaceRow: {
    alignItems: 'center',
    borderBottomColor: colors.borderMuted,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
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
    marginTop: 10,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  demoButtonText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '800',
  },
  demoHint: {
    color: colors.muted,
    fontSize: 12,
  },
  demoActive: {
    alignItems: 'center',
    backgroundColor: colors.successSoft,
    borderColor: 'rgba(63, 185, 80, 0.34)',
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    marginTop: 10,
    paddingVertical: 10,
  },
  demoActiveText: {
    color: colors.success,
    fontSize: 14,
    fontWeight: '800',
  },
})
