# JinoFin (React + Vite PWA)

See chat for full instructions. Firestore rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }

    match /households/{hid} {
      allow read, write: if signedIn() && request.auth.uid == hid;

      match /transactions/{tid} {
        allow read, write: if signedIn() && request.auth.uid == hid;
      }
      match /settings/{sid} {
        allow read, write: if signedIn() && request.auth.uid == hid;
      }
    }
  }
}
```
