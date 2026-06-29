import { createHmac } from 'node:crypto'

export const deriveRoomAuthToken = (rootAuthToken: string, roomId: string): string =>
  createHmac('sha256', rootAuthToken).update(`hive-relay-room-v2:${roomId}`).digest('base64url')
