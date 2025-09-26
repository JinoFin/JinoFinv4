# JinoFin (React + Vite PWA)

## vNext UI/UX Upgrade

- Refined design system with spacing/radius tokens, focus states, sticky safe-area aware navigation, and skeleton loaders.
- Added toast notifications with undo for deletes, pull-to-refresh hint, quick amount chips, analytics lazy-loading, and CSV preview modal.
- Offline-first polish: Firestore persistence, deferred exports, and branded offline fallback page.

**Usage notes**

- Toasts replace alerts; actions such as delete now provide undo within the toast.
- Importing CSV files now shows a preview and requires confirming before committing the rows.
- When offline, the app serves `offline.html` and queues writes until connectivity resumes.

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
