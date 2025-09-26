import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { enableIndexedDbPersistence, getFirestore } from 'firebase/firestore'
import { firebaseConfig } from './firebaseConfig'

const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const db = getFirestore(app)

enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === 'failed-precondition') {
    console.info('Firestore persistence failed-precondition (multiple tabs).')
  } else if (err.code === 'unimplemented') {
    console.info('Firestore persistence not supported in this browser.')
  } else {
    console.error('Firestore persistence error', err)
  }
})

export { app, auth, db }
