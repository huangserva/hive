import { useEffect, useMemo, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import { useMobileRuntime } from '../../src/api/mobile-runtime-context'
import { Screen } from '../../src/components/Screen'
import { StatusBadge } from '../../src/components/StatusBadge'

export default function WorkersTab() {
  const { dashboard, dispatchTask, error, restartWorker, state, stopWorker } = useMobileRuntime()
  const workers = dashboard?.workers ?? []
  const dispatchableWorkers = useMemo(
    () => workers.filter((worker) => worker.role !== 'sentinel'),
    [workers]
  )
  const [selectedWorkerId, setSelectedWorkerId] = useState('')
  const [taskText, setTaskText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!selectedWorkerId && dispatchableWorkers[0]) {
      setSelectedWorkerId(dispatchableWorkers[0].id)
      return
    }
    if (selectedWorkerId && !dispatchableWorkers.some((worker) => worker.id === selectedWorkerId)) {
      setSelectedWorkerId(dispatchableWorkers[0]?.id ?? '')
    }
  }, [dispatchableWorkers, selectedWorkerId])

  const confirmStop = (workerId: string, workerName: string) => {
    Alert.alert('Stop worker', `Stop ${workerName}?`, [
      { style: 'cancel', text: 'Cancel' },
      {
        onPress: () => {
          void stopWorker(workerId)
        },
        style: 'destructive',
        text: 'Stop',
      },
    ])
  }

  const confirmRestart = (workerId: string, workerName: string) => {
    Alert.alert('Restart worker', `Restart ${workerName}?`, [
      { style: 'cancel', text: 'Cancel' },
      {
        onPress: () => {
          void restartWorker(workerId)
        },
        text: 'Restart',
      },
    ])
  }

  const confirmDispatch = () => {
    const task = taskText.trim()
    if (!selectedWorkerId || !task) {
      Alert.alert('Dispatch task', 'Choose a worker and enter a task.')
      return
    }
    const workerName =
      dispatchableWorkers.find((worker) => worker.id === selectedWorkerId)?.name ?? 'worker'
    Alert.alert('Dispatch task', `Send this task to ${workerName}?`, [
      { style: 'cancel', text: 'Cancel' },
      {
        onPress: () => {
          setIsSubmitting(true)
          void dispatchTask(selectedWorkerId, task).then((result) => {
            setIsSubmitting(false)
            if (result) {
              setTaskText('')
              Alert.alert('Dispatched', `Dispatch ${result.dispatch_id} queued.`)
            }
          })
        },
        text: 'Dispatch',
      },
    ])
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Workers</Text>
        {!dashboard ? (
          <Text style={styles.body}>Connect in Settings first. State: {state}</Text>
        ) : null}
        {workers.length === 0 && dashboard ? (
          <Text style={styles.body}>No workers found.</Text>
        ) : null}
        {workers.map((worker) => (
          <View key={worker.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.workerTitle}>
                <Text style={styles.name}>{worker.name}</Text>
                <Text style={styles.body}>{worker.role}</Text>
              </View>
              <StatusBadge status={worker.status} />
            </View>
            <Text style={styles.meta}>Preset: {worker.preset ?? 'none'}</Text>
            <View style={styles.workerActions}>
              <Pressable
                accessibilityRole="button"
                disabled={worker.status === 'stopped'}
                onPress={() => confirmStop(worker.id, worker.name)}
                style={({ pressed }) => [
                  styles.dangerButton,
                  pressed ? styles.buttonPressed : null,
                  worker.status === 'stopped' ? styles.disabledButton : null,
                ]}
              >
                <Text style={styles.buttonText}>Stop</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => confirmRestart(worker.id, worker.name)}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed ? styles.buttonPressed : null,
                ]}
              >
                <Text style={styles.buttonText}>Restart</Text>
              </Pressable>
            </View>
          </View>
        ))}
        {dashboard ? (
          <View style={styles.dispatchCard}>
            <Text style={styles.sectionTitle}>Dispatch task</Text>
            <Text style={styles.body}>Choose a worker and send a task to the runtime.</Text>
            <View style={styles.workerPicker}>
              {dispatchableWorkers.map((worker) => (
                <Pressable
                  accessibilityRole="button"
                  key={worker.id}
                  onPress={() => setSelectedWorkerId(worker.id)}
                  style={[
                    styles.workerChip,
                    selectedWorkerId === worker.id ? styles.workerChipSelected : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.workerChipText,
                      selectedWorkerId === worker.id ? styles.workerChipTextSelected : null,
                    ]}
                  >
                    {worker.name}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              multiline
              onChangeText={setTaskText}
              placeholder="Ask this worker to..."
              placeholderTextColor="#6e7681"
              style={styles.taskInput}
              value={taskText}
            />
            <Pressable
              accessibilityRole="button"
              disabled={isSubmitting}
              onPress={confirmDispatch}
              style={({ pressed }) => [
                styles.dispatchButton,
                pressed || isSubmitting ? styles.buttonPressed : null,
              ]}
            >
              <Text style={styles.buttonText}>{isSubmitting ? 'Dispatching...' : 'Dispatch'}</Text>
            </Pressable>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: {
    color: '#8b949e',
    fontSize: 15,
    lineHeight: 22,
  },
  card: {
    backgroundColor: '#161b22',
    borderColor: '#30363d',
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  cardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  buttonPressed: {
    opacity: 0.75,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  dangerButton: {
    alignItems: 'center',
    backgroundColor: '#da3633',
    borderRadius: 10,
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  disabledButton: {
    opacity: 0.45,
  },
  dispatchButton: {
    alignItems: 'center',
    backgroundColor: '#238636',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  dispatchCard: {
    backgroundColor: '#0f1a24',
    borderColor: '#58a6ff',
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  error: {
    color: '#ff7b72',
    fontSize: 14,
  },
  meta: {
    color: '#8b949e',
    fontSize: 13,
  },
  name: {
    color: '#e6edf3',
    fontSize: 20,
    fontWeight: '700',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#30363d',
    borderRadius: 10,
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sectionTitle: {
    color: '#e6edf3',
    fontSize: 18,
    fontWeight: '700',
  },
  scroll: {
    gap: 14,
    paddingBottom: 24,
  },
  taskInput: {
    backgroundColor: '#0d1117',
    borderColor: '#30363d',
    borderRadius: 10,
    borderWidth: 1,
    color: '#e6edf3',
    fontSize: 15,
    minHeight: 100,
    paddingHorizontal: 14,
    paddingVertical: 12,
    textAlignVertical: 'top',
  },
  title: {
    color: '#e6edf3',
    fontSize: 26,
    fontWeight: '700',
  },
  workerActions: {
    flexDirection: 'row',
    gap: 10,
  },
  workerChip: {
    borderColor: '#30363d',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  workerChipSelected: {
    backgroundColor: '#1f6feb',
    borderColor: '#58a6ff',
  },
  workerChipText: {
    color: '#8b949e',
    fontSize: 14,
    fontWeight: '700',
  },
  workerChipTextSelected: {
    color: '#ffffff',
  },
  workerPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  workerTitle: {
    flex: 1,
    gap: 4,
  },
})
