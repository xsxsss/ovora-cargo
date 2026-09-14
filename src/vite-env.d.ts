/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_YANDEX_API_KEY: string;
  readonly VITE_SUPABASE_PROJECT_ID?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_YANDEX_METRIKA_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Figma Make virtual module — injected at build time
declare module '/utils/supabase/info' {
  export const projectId: string;
  export const publicAnonKey: string;
}

// Firebase module stubs (firebase package not installed; suppress TS errors)
declare module 'firebase/app' {
  export function initializeApp(config: any): any;
  export function getApp(): any;
}
declare module 'firebase/auth' {
  export function getAuth(app?: any): any;
  export function signInWithEmailAndPassword(...args: any[]): any;
  export function createUserWithEmailAndPassword(...args: any[]): any;
  export function signOut(...args: any[]): any;
  export function onAuthStateChanged(...args: any[]): any;
}
declare module 'firebase/firestore' {
  export function getFirestore(app?: any): any;
  export function collection(...args: any[]): any;
  export function doc(...args: any[]): any;
  export function getDoc(...args: any[]): any;
  export function setDoc(...args: any[]): any;
  export function updateDoc(...args: any[]): any;
  export function deleteDoc(...args: any[]): any;
  export function query(...args: any[]): any;
  export function where(...args: any[]): any;
  export function onSnapshot(...args: any[]): any;
}
declare module 'firebase/storage' {
  export function getStorage(app?: any): any;
  export function ref(...args: any[]): any;
  export function uploadBytes(...args: any[]): any;
  export function getDownloadURL(...args: any[]): any;
}
