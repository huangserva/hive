import type { InferenceSession, Tensor as OrtTensor } from 'onnxruntime-react-native'

import {
  buildSileroModelInput,
  createInitialSileroModelState,
  type SileroModelState,
  type SileroShadowFrame,
} from './neural-vad-pcm-probe'

const SILERO_SAMPLE_RATE = 16_000
const SILERO_RECURRENT_STATE_FLOAT_COUNT = 2 * 1 * 128

type OrtModule = typeof import('onnxruntime-react-native')
type OrtOutputTensor = OrtTensor & { data: unknown }
type ExpoAssetModule = typeof import('expo-asset')

export type SileroVadShadowScorer = {
  score(frame: SileroShadowFrame): Promise<number | null>
}

const loadBundledSileroModelUri = async () => {
  const { Asset } = (await import('expo-asset')) as ExpoAssetModule
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

export const createSileroVadShadowScorer = (): SileroVadShadowScorer => {
  let ortModulePromise: Promise<OrtModule> | null = null
  let sessionPromise: Promise<InferenceSession> | null = null
  let recurrentState = new Float32Array(SILERO_RECURRENT_STATE_FLOAT_COUNT)
  let modelState: SileroModelState = createInitialSileroModelState()

  const loadOrt = () => {
    ortModulePromise ??= import('onnxruntime-react-native')
    return ortModulePromise
  }

  const loadSession = async () => {
    if (sessionPromise) return sessionPromise
    sessionPromise = (async () => {
      const [ort, modelUri] = await Promise.all([loadOrt(), loadBundledSileroModelUri()])
      return ort.InferenceSession.create(modelUri)
    })()
    return sessionPromise
  }

  return {
    async score(frame) {
      const [ort, session] = await Promise.all([loadOrt(), loadSession()])
      const input = buildSileroModelInput(modelState, frame.samples)
      const feeds = {
        input: new ort.Tensor('float32', input.samples, [1, input.samples.length]),
        sr: new ort.Tensor('int64', new BigInt64Array([BigInt(SILERO_SAMPLE_RATE)]), []),
        state: new ort.Tensor('float32', recurrentState, [2, 1, 128]),
      }
      const result = (await session.run(feeds)) as Record<string, OrtOutputTensor>
      const probability = findProbabilityOutput(result)
      const nextRecurrentState = findRecurrentStateOutput(result)
      if (probability === null || nextRecurrentState === null) {
        return null
      }

      modelState = input.state
      recurrentState = nextRecurrentState.slice()
      return probability
    },
  }
}
