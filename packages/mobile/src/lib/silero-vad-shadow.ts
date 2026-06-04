import {
  buildSileroModelInput,
  createInitialSileroModelState,
  type SileroModelState,
  type SileroShadowFrame,
} from './neural-vad-pcm-probe'

const SILERO_SAMPLE_RATE = 16_000
const SILERO_RECURRENT_STATE_FLOAT_COUNT = 2 * 1 * 128
const ONNX_RUNTIME_NATIVE_MODULE_NAME = 'Onnxruntime'

type OrtTensor = { data: unknown }
type OrtOutputTensor = OrtTensor
type OrtSession = {
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtOutputTensor>>
}
type OrtRuntime = {
  InferenceSession: {
    create(modelUri: string): Promise<OrtSession>
  }
  Tensor: new (type: string, data: unknown, dims: readonly number[]) => OrtTensor
}
type ExpoAssetRuntime = {
  Asset: {
    fromModule(moduleId: number): {
      downloadAsync(): Promise<unknown>
      localUri?: string | null
      uri: string
    }
  }
}

export type SileroVadShadowScorer = {
  score(frame: SileroShadowFrame): Promise<number | null>
}

type SileroVadShadowScorerOptions = {
  hasNativeOrtModule?: () => boolean | Promise<boolean>
  loadModelUri?: () => Promise<string>
  loadOrt?: () => Promise<unknown>
  logScoreFailed?: (message: string) => void
}

type ReactNativeRuntime = {
  NativeModules?: Record<string, unknown>
}

const loadBundledSileroModelUri = async () => {
  const { Asset } = (await import(/* @vite-ignore */ 'expo-asset')) as ExpoAssetRuntime
  const sileroVadModelAsset = require('../../assets/models/silero_vad.onnx') as number
  const asset = Asset.fromModule(sileroVadModelAsset)
  await asset.downloadAsync()
  return asset.localUri ?? asset.uri
}

const findProbabilityOutput = (outputs: Record<string, OrtOutputTensor>) => {
  for (const tensor of Object.values(outputs)) {
    const data = tensor.data
    if (data instanceof Float32Array && data.length === 1) {
      return data[0] ?? null
    }
    if (Array.isArray(data) && data.length === 1 && typeof data[0] === 'number') {
      return data[0]
    }
  }
  return null
}

const findRecurrentStateOutput = (outputs: Record<string, OrtOutputTensor>) => {
  for (const tensor of Object.values(outputs)) {
    const data = tensor.data
    if (data instanceof Float32Array && data.length === SILERO_RECURRENT_STATE_FLOAT_COUNT) {
      return data
    }
  }
  return null
}

const defaultLoadOrt = async () => import(/* @vite-ignore */ 'onnxruntime-react-native')

const defaultHasNativeOrtModule = async () => {
  try {
    const reactNative = (await import(/* @vite-ignore */ 'react-native')) as ReactNativeRuntime
    return Boolean(reactNative.NativeModules?.[ONNX_RUNTIME_NATIVE_MODULE_NAME])
  } catch {
    return false
  }
}

const defaultLogScoreFailed = (message: string) => {
  console.warn(message)
}

const describeError = (error: unknown) => {
  if (error instanceof Error) return error.message
  return String(error)
}

const isOrtRuntime = (value: unknown): value is OrtRuntime => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<OrtRuntime>
  return (
    typeof candidate.Tensor === 'function' &&
    typeof candidate.InferenceSession?.create === 'function'
  )
}

export const createSileroVadShadowScorer = (
  options: SileroVadShadowScorerOptions = {}
): SileroVadShadowScorer => {
  const hasNativeOrtModule = options.hasNativeOrtModule ?? defaultHasNativeOrtModule
  const loadModelUri = options.loadModelUri ?? loadBundledSileroModelUri
  const loadOrtModule = options.loadOrt ?? defaultLoadOrt
  const logScoreFailed = options.logScoreFailed ?? defaultLogScoreFailed
  let ortModulePromise: Promise<OrtRuntime> | null = null
  let sessionPromise: Promise<OrtSession> | null = null
  let recurrentState = new Float32Array(SILERO_RECURRENT_STATE_FLOAT_COUNT)
  let modelState: SileroModelState = createInitialSileroModelState()
  let disabled = false
  let scoreFailedLogged = false

  const disableAfterFailure = (error: unknown, code = 'score_failed') => {
    disabled = true
    ortModulePromise = null
    sessionPromise = null
    if (!scoreFailedLogged) {
      scoreFailedLogged = true
      logScoreFailed(`[SILERODBG] ${code} ${describeError(error)}`)
    }
    return null
  }

  const loadOrt = () => {
    ortModulePromise ??= (async () => {
      if (!(await hasNativeOrtModule())) {
        throw new Error(`${ONNX_RUNTIME_NATIVE_MODULE_NAME} native module is unavailable`)
      }
      const ort = await loadOrtModule()
      if (!isOrtRuntime(ort)) {
        throw new Error('onnxruntime-react-native module is unavailable')
      }
      return ort
    })()
    return ortModulePromise
  }

  const loadSession = async () => {
    if (sessionPromise) return sessionPromise
    sessionPromise = (async () => {
      const [ort, modelUri] = await Promise.all([loadOrt(), loadModelUri()])
      return ort.InferenceSession.create(modelUri)
    })()
    return sessionPromise
  }

  return {
    async score(frame) {
      if (disabled) return null
      try {
        const [ort, session] = await Promise.all([loadOrt(), loadSession()])
        const input = buildSileroModelInput(modelState, frame.samples)
        const feeds = {
          input: new ort.Tensor('float32', input.samples, [1, input.samples.length]),
          sr: new ort.Tensor('int64', new BigInt64Array([BigInt(SILERO_SAMPLE_RATE)]), []),
          state: new ort.Tensor('float32', recurrentState, [2, 1, 128]),
        }
        const result = await session.run(feeds)
        const probability = findProbabilityOutput(result)
        const nextRecurrentState = findRecurrentStateOutput(result)
        if (probability === null || nextRecurrentState === null) {
          return null
        }

        modelState = input.state
        recurrentState = nextRecurrentState.slice()
        return probability
      } catch (error) {
        const errorMessage = describeError(error)
        const code = errorMessage.includes(
          `${ONNX_RUNTIME_NATIVE_MODULE_NAME} native module is unavailable`
        )
          ? 'neural_unavailable'
          : 'score_failed'
        return disableAfterFailure(error, code)
      }
    },
  }
}
