import { Ionicons } from '@expo/vector-icons'
import { type BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera'
import * as Clipboard from 'expo-clipboard'
import Constants from 'expo-constants'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'
import type { ComponentProps } from 'react'
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import type { MobileConnectionDiagnostics } from '../../src/api/mobile-diagnostics'
import { useMobileRuntime } from '../../src/api/mobile-runtime-context'
import { ConnectionModeBadge } from '../../src/components/ConnectionModeBanner'
import { Screen } from '../../src/components/Screen'
import { type TFunction, useLanguage, useT } from '../../src/i18n'
import {
  ALL_MOBILE_CAPABILITIES,
  parseConnectionQr,
  type RelayPairingInput,
} from '../../src/lib/connection-qr'
import { decodeConnectionQrOutcomeFromPngBase64 } from '../../src/lib/qr-image-decode'
import type { StoredRelayConfig } from '../../src/lib/relay-config-store'
import { colors, radius, spacing } from '../../src/theme'

// 相册图先归一成 PNG 喂纯 JS 解码；过大图按此上限缩边，限住解码耗时/内存，又保住二维码清晰度。
const PHOTO_QR_MAX_EDGE = 1500

type IconName = ComponentProps<typeof Ionicons>['name']

export interface ApplyScannedConnectionQrInput {
  configureRelay: (input: RelayPairingInput) => Promise<StoredRelayConfig>
  connect: (host: string, token: string, relayConfig?: StoredRelayConfig | null) => Promise<unknown>
  onConnected: () => void
  onRelayConfigureFailed: (error: unknown) => void
  relayConfig: StoredRelayConfig | null
  setDraftHost: (host: string) => void
  setDraftToken: (token: string) => void
  setHost: (host: string) => void
  setScanLocked: (locked: boolean) => void
  setScannerOpen: (open: boolean) => void
  setToken: (token: string) => void
}

export const applyScannedConnectionQrFlow = async (
  payload: { host: string; relay?: RelayPairingInput; token: string },
  input: ApplyScannedConnectionQrInput
) => {
  input.setScannerOpen(false)
  input.setScanLocked(false)
  input.setDraftHost(payload.host)
  input.setDraftToken(payload.token)
  input.setHost(payload.host)
  input.setToken(payload.token)

  let connectRelayConfig = input.relayConfig
  if (payload.relay) {
    try {
      connectRelayConfig = await input.configureRelay(payload.relay)
    } catch (error) {
      input.onRelayConfigureFailed(error)
      return
    }
  }

  const connected = await input.connect(payload.host, payload.token, connectRelayConfig)
  if (connected) input.onConnected()
}

export default function SettingsTab() {
  const { language, setLanguage } = useLanguage()
  const t = useT()
  const {
    configureRelay,
    connectionMode,
    connectionDiagnostics,
    connectionDiagnosticsText,
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
  const [photoScanBusy, setPhotoScanBusy] = useState(false)
  const [relayFormOpen, setRelayFormOpen] = useState(false)
  const [relayUrl, setRelayUrl] = useState('')
  const [relayRoom, setRelayRoom] = useState('')
  const [relayAuthToken, setRelayAuthToken] = useState('')
  const [relayDaemonKey, setRelayDaemonKey] = useState('')
  const [relayDeviceId, setRelayDeviceId] = useState('')
  const [switchingConnectionTarget, setSwitchingConnectionTarget] = useState<
    'lan' | 'relay' | null
  >(null)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)

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

  const closeScanner = useCallback(() => {
    setScannerOpen(false)
    setScanLocked(false)
    setPhotoScanBusy(false)
  }, [])

  const applyScannedConnectionQr = useCallback(
    async (payload: { host: string; relay?: RelayPairingInput; token: string }) => {
      await applyScannedConnectionQrFlow(payload, {
        configureRelay,
        connect,
        onConnected: () => Alert.alert(t('common.connected'), t('settings.connectedFromQr')),
        onRelayConfigureFailed: () => {
          setScanLocked(false)
          Alert.alert(
            t('settings.relayManualIncompleteTitle'),
            t('settings.relayManualIncompleteBody')
          )
        },
        relayConfig,
        setDraftHost,
        setDraftToken,
        setHost,
        setScanLocked,
        setScannerOpen,
        setToken,
      })
    },
    [connect, configureRelay, relayConfig, setHost, setToken, t]
  )

  const onBarcodeScanned = async (result: BarcodeScanningResult) => {
    if (scanLocked) return
    setScanLocked(true)
    const payload = parseConnectionQr(result.data)
    if (!payload) {
      setScannerOpen(false)
      setScanLocked(false)
      Alert.alert(t('settings.invalidQrTitle'), t('settings.invalidQrBody'))
      return
    }
    await applyScannedConnectionQr(payload)
  }

  const onPickQrFromPhoto = useCallback(async () => {
    if (photoScanBusy || scanLocked) return
    setPhotoScanBusy(true)
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!permission.granted) {
        Alert.alert(t('settings.photoPermissionTitle'), t('settings.photoPermissionBody'))
        return
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: false,
        base64: false,
        mediaTypes: ['images'],
        quality: 1,
      })
      const asset = result.canceled ? null : (result.assets?.[0] ?? null)
      if (!asset?.uri) return
      // 绕开 expo-camera 的 scanFromURLAsync（安卓不靠谱）：把选中图归一成 PNG base64，
      // 再用纯 JS（upng + jsQR）解码——不依赖原生/GMS，华为机能用。
      const longestEdge = Math.max(asset.width ?? 0, asset.height ?? 0)
      const resizeActions =
        longestEdge > PHOTO_QR_MAX_EDGE
          ? [
              (asset.width ?? 0) >= (asset.height ?? 0)
                ? { resize: { width: PHOTO_QR_MAX_EDGE } }
                : { resize: { height: PHOTO_QR_MAX_EDGE } },
            ]
          : []
      const normalized = await manipulateAsync(asset.uri, resizeActions, {
        base64: true,
        format: SaveFormat.PNG,
      })
      const outcome = normalized.base64
        ? decodeConnectionQrOutcomeFromPngBase64(normalized.base64)
        : ({ status: 'decode-failed' } as const)
      if (outcome.status === 'ok') {
        await applyScannedConnectionQr(outcome.payload)
        return
      }
      // 按结局给不同提示，不再一律"未找到二维码"。
      if (outcome.status === 'not-connection') {
        Alert.alert(t('settings.photoQrInvalidTitle'), t('settings.photoQrInvalidBody'))
      } else if (outcome.status === 'decode-failed') {
        Alert.alert(t('settings.photoQrDecodeFailedTitle'), t('settings.photoQrDecodeFailedBody'))
      } else {
        Alert.alert(t('settings.photoQrNotFoundTitle'), t('settings.photoQrNotFoundBody'))
      }
    } catch {
      // manipulateAsync 等原生异常 = 图片读不出来。
      Alert.alert(t('settings.photoQrDecodeFailedTitle'), t('settings.photoQrDecodeFailedBody'))
    } finally {
      setPhotoScanBusy(false)
    }
  }, [applyScannedConnectionQr, photoScanBusy, scanLocked, t])

  const onSaveManualRelay = async () => {
    const input: RelayPairingInput = {
      capabilities: ALL_MOBILE_CAPABILITIES,
      daemon_public_key: relayDaemonKey.trim(),
      device_id: relayDeviceId.trim(),
      relay_auth_token: relayAuthToken.trim(),
      relay_url: relayUrl.trim(),
      room_id: relayRoom.trim(),
    }
    if (
      !input.relay_url ||
      !input.room_id ||
      !input.relay_auth_token ||
      !input.daemon_public_key ||
      !input.device_id
    ) {
      Alert.alert(t('settings.relayManualIncompleteTitle'), t('settings.relayManualIncompleteBody'))
      return
    }
    await configureRelay(input)
    setRelayFormOpen(false)
    Alert.alert(t('settings.relayManualSavedTitle'), t('settings.relayManualSavedBody'))
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

  const onCopyDiagnostics = async () => {
    await Clipboard.setStringAsync(connectionDiagnosticsText)
    Alert.alert(t('settings.diagnosticsCopiedTitle'), t('settings.diagnosticsCopiedBody'))
  }

  const switchConnectionDetail = useCallback(
    async (target: 'lan' | 'relay') => {
      if (switchingConnectionTarget || !token.trim()) return
      if (target === 'relay' && !relayConfig) return
      setSwitchingConnectionTarget(target)
      try {
        await connect(host, token, relayConfig, {
          preferredConnectionMode: target,
        })
      } finally {
        setSwitchingConnectionTarget(null)
      }
    },
    [connect, host, relayConfig, switchingConnectionTarget, token]
  )

  const isConnected = state === 'connected'
  const lanAvailable = connectionMode === 'lan' || isConnected
  const deviceMeta = [
    pairedDevice?.device_type,
    formatDateLabel(t('settings.created'), pairedDevice?.created_at, language),
    formatDateLabel(t('settings.lastSeen'), pairedDevice?.last_seen_at, language),
  ]
    .filter(Boolean)
    .join(' • ')
  const deviceCapabilities = pairedDevice?.capabilities ?? []
  const relayMeta = relayConfig
    ? [
        relayConfig.relay_url,
        relayConfig.room_id ? t('settings.relayRoomValue', { room: relayConfig.room_id }) : null,
      ]
        .filter(Boolean)
        .join(' • ')
    : null
  const lanMeta = [
    host || null,
    runtimeStatus?.port ? t('settings.lanPortValue', { port: runtimeStatus.port }) : null,
  ]
    .filter(Boolean)
    .join(' • ')
  const appBuildLabel = getAppBuildLabel(t)

  return (
    <Screen showConnectionModeBanner={false}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text numberOfLines={1} style={styles.title}>
            {t('settings.title')}
          </Text>
          <View style={styles.headerStatus}>
            <ConnectionModeBadge />
            <ConnectionBadge state={state} />
          </View>
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
                    {option === 'en'
                      ? t('settings.languageEnglish')
                      : t('settings.languageChinese')}
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
              placeholder={t('settings.connectHostPlaceholder')}
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
            disabled={!token.trim() || !relayConfig || switchingConnectionTarget !== null}
            meta={relayMeta}
            loading={switchingConnectionTarget === 'relay'}
            onPress={() => void switchConnectionDetail('relay')}
            status={
              switchingConnectionTarget === 'relay'
                ? t('chat.status.connecting')
                : connectionMode === 'relay'
                  ? t('common.connected')
                  : t('common.disconnected')
            }
            title={t('settings.relay')}
            tone={connectionMode === 'relay' ? 'success' : 'muted'}
          />
          <View style={styles.divider} />
          <ConnectionDetailRow
            icon="git-network-outline"
            disabled={!token.trim() || switchingConnectionTarget !== null}
            meta={lanMeta || null}
            loading={switchingConnectionTarget === 'lan'}
            onPress={() => void switchConnectionDetail('lan')}
            status={
              switchingConnectionTarget === 'lan'
                ? t('chat.status.connecting')
                : lanAvailable
                  ? t('common.available')
                  : t('common.unavailable')
            }
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

        <Pressable
          accessibilityRole="button"
          onPress={() => setDiagnosticsOpen((open) => !open)}
          style={styles.diagnosticsToggle}
        >
          <Ionicons color={colors.accent} name="pulse-outline" size={18} />
          <View style={styles.diagnosticsToggleCopy}>
            <Text style={styles.diagnosticsToggleText}>{t('settings.diagnosticsTitle')}</Text>
            <Text style={styles.diagnosticsToggleHint}>{t('settings.diagnosticsHint')}</Text>
          </View>
          <Ionicons
            color={colors.muted}
            name={diagnosticsOpen ? 'chevron-up' : 'chevron-down'}
            size={18}
          />
        </Pressable>
        {diagnosticsOpen ? (
          <View style={styles.diagnosticsCard}>
            <View style={styles.diagnosticsGrid}>
              <DiagnosticRow
                label={t('settings.diagnosticsState')}
                value={connectionDiagnostics.state}
              />
              <DiagnosticRow
                label={t('settings.diagnosticsMode')}
                tone={connectionDiagnostics.connectionMode}
                value={connectionDiagnostics.connectionMode}
              />
              <DiagnosticRow
                label={t('settings.diagnosticsLastError')}
                value={connectionDiagnostics.error ?? t('common.unknown')}
              />
              <DiagnosticRow
                label={t('settings.diagnosticsHost')}
                value={connectionDiagnostics.host}
              />
              <DiagnosticRow
                label={t('settings.diagnosticsRelayConfigured')}
                value={
                  connectionDiagnostics.relay.configured
                    ? t('common.available')
                    : t('common.unavailable')
                }
              />
              <DiagnosticRow
                label={t('settings.relayUrl')}
                value={connectionDiagnostics.relay.relay_url ?? t('common.unknown')}
              />
              <DiagnosticRow
                label={t('settings.relayRoom')}
                value={connectionDiagnostics.relay.room_id ?? t('common.unknown')}
              />
              <DiagnosticRow
                label={t('settings.relayDeviceId')}
                value={connectionDiagnostics.relay.device_id ?? t('common.unknown')}
              />
              <DiagnosticRow
                label={t('settings.diagnosticsToken')}
                value={connectionDiagnostics.relay.token}
              />
              <DiagnosticRow
                label={t('settings.diagnosticsLanAttempt')}
                value={formatLanDiagnostic(connectionDiagnostics.lastLanAttempt, t)}
              />
              <DiagnosticRow
                label={t('settings.diagnosticsRelayAttempt')}
                value={formatRelayDiagnostic(connectionDiagnostics.lastRelayResult, t)}
              />
            </View>
            <View style={styles.divider} />
            <Text style={styles.diagnosticsEventTitle}>{t('settings.diagnosticsEvents')}</Text>
            {connectionDiagnostics.events.length === 0 ? (
              <Text style={styles.detail}>{t('settings.diagnosticsNoEvents')}</Text>
            ) : (
              connectionDiagnostics.events.map((event) => (
                <Text
                  key={`${event.ts}-${event.type}-${event.detail ?? ''}`}
                  style={styles.eventLine}
                >
                  {formatEventTime(event.ts)} · {event.type}
                  {event.detail ? ` · ${event.detail}` : ''}
                </Text>
              ))
            )}
            <Pressable
              accessibilityRole="button"
              onPress={() => void onCopyDiagnostics()}
              style={styles.copyDiagnosticsButton}
            >
              <Ionicons color={colors.background} name="copy-outline" size={18} />
              <Text style={styles.primaryButtonText}>{t('settings.diagnosticsCopy')}</Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          onPress={() => setRelayFormOpen((open) => !open)}
          style={styles.relayToggle}
        >
          <Ionicons color={colors.accent} name="globe-outline" size={18} />
          <Text style={styles.relayToggleText}>{t('settings.relayManual')}</Text>
          <Ionicons
            color={colors.muted}
            name={relayFormOpen ? 'chevron-up' : 'chevron-down'}
            size={18}
          />
        </Pressable>
        {relayFormOpen ? (
          <View style={styles.relayForm}>
            <Text style={styles.formHint}>{t('settings.relayManualHint')}</Text>
            {(
              [
                ['settings.relayUrl', relayUrl, setRelayUrl, 'wss://relay.example.com'],
                ['settings.relayRoom', relayRoom, setRelayRoom, 'room-...'],
                ['settings.relayAuthToken', relayAuthToken, setRelayAuthToken, 'auth token'],
                ['settings.relayDaemonKey', relayDaemonKey, setRelayDaemonKey, 'daemon public key'],
                ['settings.relayDeviceId', relayDeviceId, setRelayDeviceId, 'device id'],
              ] as const
            ).map(([labelKey, value, setter, placeholder]) => (
              <View key={labelKey} style={styles.inputShell}>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={setter}
                  placeholder={placeholder}
                  placeholderTextColor={colors.muted2}
                  style={styles.input}
                  value={value}
                />
              </View>
            ))}
            <Pressable
              accessibilityRole="button"
              onPress={() => void onSaveManualRelay()}
              style={styles.primaryButton}
            >
              <Ionicons color={colors.background} name="save-outline" size={19} />
              <Text style={styles.primaryButtonText}>{t('settings.relayManualSave')}</Text>
            </Pressable>
          </View>
        ) : null}

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

      <Modal animationType="slide" visible={scannerOpen} onRequestClose={closeScanner}>
        <View style={styles.scannerScreen}>
          <View style={styles.scannerHeader}>
            <View>
              <Text style={styles.scannerTitle}>{t('settings.scanQrTitle')}</Text>
              <Text style={styles.scannerSubtitle}>{t('settings.scanQrSubtitle')}</Text>
            </View>
            <Pressable
              accessibilityLabel={t('settings.closeScanner')}
              accessibilityRole="button"
              onPress={closeScanner}
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
          <View style={styles.scannerActions}>
            <Pressable
              accessibilityRole="button"
              disabled={photoScanBusy}
              onPress={() => void onPickQrFromPhoto()}
              style={[styles.scanPhotoButton, photoScanBusy && styles.buttonDisabled]}
            >
              <Ionicons color={colors.background} name="images-outline" size={18} />
              <Text style={styles.scanPhotoButtonText}>
                {photoScanBusy ? t('settings.scanningPhoto') : t('settings.scanFromPhotos')}
              </Text>
            </Pressable>
          </View>
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

const formatDateLabel = (label: string, value?: string | null, language = 'en') => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return `${label} ${new Intl.DateTimeFormat(language.startsWith('zh') ? 'zh-CN' : 'en-US', {
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

const Capability = ({ icon, label }: { icon?: IconName; label: string }) => (
  <View style={styles.capabilityChip}>
    {icon ? <Ionicons color={colors.accent} name={icon} size={16} /> : null}
    <Text style={styles.capabilityText}>{label}</Text>
  </View>
)

const ConnectionDetailRow = ({
  icon,
  loading = false,
  meta,
  onPress,
  disabled = false,
  status,
  title,
  tone,
}: {
  icon: IconName
  disabled?: boolean
  loading?: boolean
  meta: string | null
  onPress?: () => void
  status: string
  title: string
  tone: 'accent' | 'muted' | 'success'
}) => {
  const t = useT()
  const toneColor =
    tone === 'success' ? colors.success : tone === 'accent' ? colors.accent : colors.muted
  const content = (
    <>
      <View style={[styles.connectionIcon, { backgroundColor: `${toneColor}18` }]}>
        <Ionicons color={toneColor} name={icon} size={23} />
      </View>
      <View style={styles.connectionDetailCopy}>
        <View style={styles.connectionTitleRow}>
          <Text style={styles.connectionDetailTitle}>{title}</Text>
          <View style={[styles.statusPill, { backgroundColor: `${toneColor}18` }]}>
            <Text style={[styles.statusPillText, { color: toneColor }]}>
              {loading ? t('chat.status.connecting') : status}
            </Text>
          </View>
        </View>
        {meta ? <Text style={styles.connectionMeta}>{meta}</Text> : null}
      </View>
      {loading ? (
        <ActivityIndicator color={toneColor} size="small" />
      ) : (
        <Ionicons color={colors.muted} name="chevron-forward" size={22} />
      )}
    </>
  )

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled, busy: loading }}
        disabled={disabled || loading}
        onPress={onPress}
        style={({ pressed }) => [
          styles.connectionDetailRow,
          pressed ? styles.connectionDetailRowPressed : null,
          disabled ? styles.connectionDetailRowDisabled : null,
        ]}
      >
        {content}
      </Pressable>
    )
  }

  return <View style={styles.connectionDetailRow}>{content}</View>
}

const DiagnosticRow = ({
  label,
  tone,
  value,
}: {
  label: string
  tone?: 'disconnected' | 'lan' | 'relay'
  value: string
}) => {
  const toneColor =
    tone === 'relay' ? colors.accent : tone === 'lan' ? colors.success : colors.muted
  return (
    <View style={styles.diagnosticRow}>
      <Text style={styles.diagnosticLabel}>{label}</Text>
      <Text selectable style={[styles.diagnosticValue, tone ? { color: toneColor } : null]}>
        {value}
      </Text>
    </View>
  )
}

const formatLanDiagnostic = (
  attempt: MobileConnectionDiagnostics['lastLanAttempt'],
  t: TFunction
) => {
  if (!attempt) return t('settings.diagnosticsNone')
  const result = attempt.ok ? t('common.available') : t('common.unavailable')
  const duration = attempt.durationMs === undefined ? '' : ` · ${attempt.durationMs}ms`
  const error = attempt.error ? ` · ${attempt.error}` : ''
  return `${result} · ${attempt.path ?? 'LAN'}${duration}${error}`
}

const formatRelayDiagnostic = (
  attempt: MobileConnectionDiagnostics['lastRelayResult'],
  t: TFunction
) => {
  if (!attempt) return t('settings.diagnosticsNone')
  const result = attempt.ok ? t('common.available') : t('common.unavailable')
  const status = attempt.status ? ` · ${attempt.status}` : ''
  const error = attempt.error ? ` · ${attempt.error}` : ''
  return `${result} · ${attempt.method ?? 'relay'}${status}${error}`
}

const formatEventTime = (ts: number) =>
  new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(ts))

const ConnectionBadge = ({ state }: { state: 'idle' | 'checking' | 'connected' | 'error' }) => {
  const t = useT()
  const isConnected = state === 'connected'
  const stateLabel = isConnected
    ? t('settings.connState.connected')
    : state === 'checking'
      ? t('settings.connState.checking')
      : state === 'error'
        ? t('settings.connState.error')
        : t('settings.connState.idle')
  return (
    <View style={[styles.badge, isConnected ? styles.badgeConnected : styles.badgeIdle]}>
      <Text style={styles.badgeText}>{stateLabel}</Text>
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
  connectionDetailRowDisabled: { opacity: 0.45 },
  connectionDetailRowPressed: { backgroundColor: colors.cardElevated },
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
  copyDiagnosticsButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    marginTop: 4,
    paddingVertical: 11,
  },
  diagnosticLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  diagnosticRow: {
    gap: 3,
  },
  diagnosticValue: {
    color: colors.textSoft,
    fontSize: 12,
    lineHeight: 17,
  },
  diagnosticsCard: {
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: 10,
    padding: spacing.sm,
  },
  diagnosticsEventTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  diagnosticsGrid: {
    gap: 9,
  },
  diagnosticsToggle: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: spacing.sm,
  },
  diagnosticsToggleCopy: {
    flex: 1,
    gap: 3,
  },
  diagnosticsToggleHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  diagnosticsToggleText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
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
  eventLine: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
  },
  fieldHeader: { gap: 3 },
  fieldSubtitle: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  fieldTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  formHint: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  relayToggle: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  relayToggleText: {
    color: colors.text,
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  relayForm: {
    gap: spacing.sm,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  headerStatus: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'nowrap',
    minWidth: 0,
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
  buttonDisabled: {
    opacity: 0.5,
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
  scanPhotoButton: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  scanPhotoButtonText: {
    color: colors.background,
    fontSize: 14,
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
  scannerActions: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
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
    flexShrink: 1,
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
