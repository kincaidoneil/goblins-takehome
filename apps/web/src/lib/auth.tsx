/**
 * Teacher sign-in on the client. Clerk runs only when the build has a publishable key. Without one
 * (local development and CI E2E in `AUTH_MODE=local`) there is no Clerk at all: the server signs
 * every request in as the local teacher, and these components fall back to plain markup.
 */
import {
  ClerkProvider,
  SignInButton,
  UserButton,
  useAuth,
  useClerk,
  useUser,
} from "@clerk/tanstack-react-start";
import type { ReactElement, ReactNode } from "react";

const publishableKey: unknown = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

/** Fixed per build, so branching on it never changes hook order. */
export const clerkEnabled = typeof publishableKey === "string" && publishableKey !== "";

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  return clerkEnabled ? <ClerkProvider>{children}</ClerkProvider> : <>{children}</>;
}

export interface TeacherAuth {
  /** Undefined while Clerk loads. */
  readonly isSignedIn: boolean | undefined;
  /** An email or name to show, if known. */
  readonly label: string | null;
  /** Opens sign-in, returning to `redirectUrl` afterwards. */
  readonly openSignIn: (redirectUrl: string) => void;
}

const useClerkTeacherAuth = (): TeacherAuth => {
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const clerk = useClerk();
  return {
    isSignedIn,
    label: user?.primaryEmailAddress?.emailAddress ?? user?.fullName ?? null,
    openSignIn: (redirectUrl) =>
      clerk.openSignIn({ forceRedirectUrl: redirectUrl, signUpForceRedirectUrl: redirectUrl }),
  };
};

const useLocalTeacherAuth = (): TeacherAuth => ({
  isSignedIn: true,
  label: "the local teacher",
  openSignIn: (redirectUrl) => {
    window.location.href = redirectUrl;
  },
});

export const useTeacherAuth: () => TeacherAuth = clerkEnabled
  ? useClerkTeacherAuth
  : useLocalTeacherAuth;

/** Wraps a button so clicking it opens Clerk's sign-in modal. Without Clerk, renders the button. */
export function SignInTrigger({ children }: { readonly children: ReactElement }) {
  return clerkEnabled ? <SignInButton mode="modal">{children}</SignInButton> : children;
}

/** The signed-in teacher's account menu, when Clerk runs. */
export function AccountButton() {
  return clerkEnabled ? <UserButton /> : null;
}
