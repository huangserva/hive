import { Ionicons } from '@expo/vector-icons'
import { type ComponentProps, useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'

import type {
  MobileCommandPreset,
  MobileCreateWorkerInput,
  MobileCreateWorkerResponse,
} from '../api/client'
import { useT } from '../i18n'
import { toThinkingLevelOptions } from '../lib/thinking-levels'
import { colors, radius, spacing } from '../theme'

// 移动端可创建的角色（不含 sentinel：哨兵唯一且 PC 专属）。
const CREATABLE_ROLES = ['coder', 'tester', 'reviewer', 'custom'] as const
type CreatableRole = (typeof CREATABLE_ROLES)[number]

type AddWorkerModalProps = {
  listCommandPresets: () => Promise<MobileCommandPreset[]>
  onClose: () => void
  onCreate: (input: MobileCreateWorkerInput) => Promise<MobileCreateWorkerResponse | null>
  visible: boolean
}

export const AddWorkerModal = ({
  listCommandPresets,
  onClose,
  onCreate,
  visible,
}: AddWorkerModalProps) => {
  const t = useT()
  const [name, setName] = useState('')
  const [role, setRole] = useState<CreatableRole>('coder')
  const [presetId, setPresetId] = useState<string | null>(null)
  const [thinkingLevel, setThinkingLevel] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [autostart, setAutostart] = useState(true)
  const [presets, setPresets] = useState<MobileCommandPreset[]>([])
  const [loadingPresets, setLoadingPresets] = useState(false)
  const [creating, setCreating] = useState(false)

  const reset = useCallback(() => {
    setName('')
    setRole('coder')
    setPresetId(null)
    setThinkingLevel(null)
    setDescription('')
    setAutostart(true)
  }, [])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    setLoadingPresets(true)
    void listCommandPresets().then((next) => {
      if (cancelled) return
      setPresets(next)
      // 默认选第一个可用的 preset，省一步点击。
      setPresetId((current) => current ?? next.find((p) => p.available !== false)?.id ?? null)
      setLoadingPresets(false)
    })
    return () => {
      cancelled = true
    }
  }, [visible, listCommandPresets])

  const selectedPreset = presets.find((preset) => preset.id === presetId)
  const thinkingLevels = toThinkingLevelOptions(selectedPreset?.thinking_levels)

  const handleClose = () => {
    if (creating) return
    onClose()
  }

  const submit = async () => {
    if (!name.trim()) {
      Alert.alert(t('addWorker.failed'), t('addWorker.nameRequired'))
      return
    }
    if (!presetId) {
      Alert.alert(t('addWorker.failed'), t('addWorker.presetRequired'))
      return
    }
    setCreating(true)
    const result = await onCreate({
      autostart,
      command_preset_id: presetId,
      description: description.trim() || undefined,
      name: name.trim(),
      role,
      thinking_level: thinkingLevel,
    })
    setCreating(false)
    if (result) {
      Alert.alert(t('addWorker.created'), t('addWorker.createdBody', { name: result.name ?? name }))
      reset()
      onClose()
      return
    }
    Alert.alert(t('addWorker.failed'), '')
  }

  return (
    <Modal animationType="fade" transparent visible={visible}>
      <View style={styles.backdrop}>
        <View style={styles.modal}>
          <Text style={styles.title}>{t('addWorker.title')}</Text>
          <ScrollView
            contentContainerStyle={styles.form}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Field label={t('addWorker.name')}>
              <TextInput
                autoFocus
                onChangeText={setName}
                placeholder={t('addWorker.namePlaceholder')}
                placeholderTextColor={colors.muted2}
                style={styles.input}
                value={name}
              />
            </Field>

            <Field label={t('addWorker.role')}>
              <View style={styles.chipRow}>
                {CREATABLE_ROLES.map((value) => (
                  <SelectChip
                    key={value}
                    label={t(`addWorker.role.${value}`)}
                    onPress={() => setRole(value)}
                    selected={role === value}
                  />
                ))}
              </View>
            </Field>

            <Field label={t('addWorker.preset')}>
              {loadingPresets ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color={colors.accent} size="small" />
                  <Text style={styles.loadingText}>{t('addWorker.presetLoading')}</Text>
                </View>
              ) : (
                <View style={styles.presetGrid}>
                  {presets.map((preset) => (
                    <PresetCard
                      key={preset.id}
                      disabled={preset.available === false}
                      label={
                        preset.available === false
                          ? t('addWorker.presetUnavailable', { name: preset.display_name })
                          : preset.display_name
                      }
                      onPress={() => {
                        setPresetId(preset.id)
                        setThinkingLevel(null)
                      }}
                      presetId={preset.id}
                      selected={presetId === preset.id}
                    />
                  ))}
                </View>
              )}
            </Field>

            {thinkingLevels.length > 0 ? (
              <Field label={t('addWorker.thinkingLevel')}>
                <View style={styles.chipRow}>
                  <SelectChip
                    label={t('addWorker.thinkingLevelDefault')}
                    onPress={() => setThinkingLevel(null)}
                    selected={thinkingLevel === null}
                  />
                  {thinkingLevels.map((level) => (
                    <SelectChip
                      key={level.value}
                      label={level.label}
                      onPress={() => setThinkingLevel(level.value)}
                      selected={thinkingLevel === level.value}
                    />
                  ))}
                </View>
              </Field>
            ) : null}

            <Field label={t('addWorker.description')}>
              <TextInput
                multiline
                onChangeText={setDescription}
                placeholder={t('addWorker.descriptionPlaceholder')}
                placeholderTextColor={colors.muted2}
                style={[styles.input, styles.textArea]}
                value={description}
              />
            </Field>

            <View style={styles.switchRow}>
              <View style={styles.switchLabel}>
                <Text style={styles.fieldLabel}>{t('addWorker.autostart')}</Text>
                <Text style={styles.switchHint}>{t('addWorker.autostartHint')}</Text>
              </View>
              <Switch
                onValueChange={setAutostart}
                thumbColor={colors.text}
                trackColor={{ false: colors.borderMuted, true: colors.accent }}
                value={autostart}
              />
            </View>
          </ScrollView>

          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={handleClose} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>{t('addWorker.cancel')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={creating}
              onPress={submit}
              style={[styles.submitBtn, creating && styles.btnDisabled]}
            >
              <Text style={styles.submitText}>
                {creating ? t('addWorker.creating') : t('addWorker.create')}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const Field = ({ children, label }: { children: React.ReactNode; label: string }) => (
  <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    {children}
  </View>
)

const SelectChip = ({
  disabled = false,
  label,
  onPress,
  selected,
}: {
  disabled?: boolean
  label: string
  onPress: () => void
  selected: boolean
}) => (
  <Pressable
    accessibilityRole="button"
    accessibilityState={{ disabled, selected }}
    disabled={disabled}
    onPress={onPress}
    style={[styles.chip, selected && styles.chipSelected, disabled && styles.chipDisabled]}
  >
    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
  </Pressable>
)

type IoniconName = ComponentProps<typeof Ionicons>['name']

// AGENT CLI 视觉身份：每个内置 preset 一个可辨识图标 + 品牌色点缀（语义：
// Claude=星芒 spark / Codex=终端 terminal / OpenCode=代码括号 </> / Gemini=闪钻 diamond）。
// 图标来自 @expo/vector-icons 的 Ionicons（随包内置，离线可用，无网络/CDN）。
const PRESET_VISUALS: Record<string, { color: string; icon: IoniconName }> = {
  claude: { color: '#d97706', icon: 'sparkles' },
  codex: { color: '#10a37f', icon: 'terminal' },
  gemini: { color: '#8b7cf6', icon: 'diamond' },
  opencode: { color: '#f78166', icon: 'code-slash' },
}
const FALLBACK_VISUAL: { color: string; icon: IoniconName } = {
  color: colors.muted,
  icon: 'hardware-chip-outline',
}

const PresetCard = ({
  disabled = false,
  label,
  onPress,
  presetId,
  selected,
}: {
  disabled?: boolean
  label: string
  onPress: () => void
  presetId: string
  selected: boolean
}) => {
  const visual = PRESET_VISUALS[presetId] ?? FALLBACK_VISUAL
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.presetCard,
        selected && styles.presetCardSelected,
        disabled && styles.presetCardDisabled,
      ]}
    >
      <View style={[styles.presetIconWrap, { backgroundColor: `${visual.color}22` }]}>
        <Ionicons color={visual.color} name={visual.icon} size={20} />
      </View>
      <Text numberOfLines={2} style={[styles.presetLabel, selected && styles.presetLabelSelected]}>
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    marginTop: spacing.sm,
  },
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.68)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  btnDisabled: {
    opacity: 0.45,
  },
  cancelBtn: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  cancelText: {
    color: colors.textSoft,
    fontSize: 14,
    fontWeight: '800',
  },
  chip: {
    backgroundColor: colors.cardElevated,
    borderColor: colors.borderMuted,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  chipDisabled: {
    opacity: 0.4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chipSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  chipText: {
    color: colors.textSoft,
    fontSize: 13,
    fontWeight: '700',
  },
  chipTextSelected: {
    color: colors.accent,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  form: {
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  input: {
    backgroundColor: colors.cardElevated,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: 15,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  loadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 13,
  },
  modal: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    maxHeight: '86%',
    padding: spacing.md,
    width: '100%',
  },
  presetCard: {
    alignItems: 'center',
    backgroundColor: colors.cardElevated,
    borderColor: colors.borderMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    flexBasis: '47%',
    flexDirection: 'row',
    flexGrow: 1,
    gap: 10,
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  presetCardDisabled: {
    opacity: 0.4,
  },
  presetCardSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  presetIconWrap: {
    alignItems: 'center',
    borderRadius: radius.sm,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  presetLabel: {
    color: colors.textSoft,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '700',
  },
  presetLabelSelected: {
    color: colors.accent,
  },
  submitBtn: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  submitText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },
  switchHint: {
    color: colors.muted,
    fontSize: 12,
  },
  switchLabel: {
    flex: 1,
    gap: 2,
  },
  switchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
})
