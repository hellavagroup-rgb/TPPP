import { createContext, useContext, useState, ReactNode, useEffect } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import * as api from "./api";
import { setAuthLossHandler } from "./queryClient";
import type { SafeUser } from "@shared/schema";

export type UserRole = "admin" | "clinician";

export interface NotificationPrefs {
  newReferrals?: boolean;
  waitlistUpdates?: boolean;
  taskAssignments?: boolean;
  formCompletions?: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  linkedClinicianId?: string | null;
  notificationPrefs?: NotificationPrefs;
}

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  isLoading: boolean;
}

export type LoginResult =
  | { success: true }
  | { success: false; kind: "credentials" | "service"; message: string };

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function isPublicAuthLocation(location: string): boolean {
  return location === "/login"
    || location.startsWith("/fill/")
    || location.startsWith("/accept-invite")
    || location.startsWith("/reset-password")
    || location.startsWith("/payment-success")
    || location.startsWith("/payment-cancel")
    || location.startsWith("/options/")
    || location.startsWith("/register/");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();

  useEffect(() => {
    setAuthLossHandler(() => {
      // A 401 means the server no longer accepts this session. Never leave
      // tenant-scoped cached records visible while routing to sign-in.
      // Public client journeys do not have staff sessions and must never be
      // redirected to the staff login because one of their public APIs failed.
      if (isPublicAuthLocation(location)) return;
      console.info("[auth] session expired or invalid; clearing tenant cache");
      setUser(null);
      queryClient.clear();
      setLocation("/login");
    });
    return () => setAuthLossHandler(null);
  }, [location, queryClient, setLocation]);

  // Check if user is already logged in on mount
  useEffect(() => {
    async function checkAuth() {
      try {
        const currentUser = await api.getCurrentUser();
        if (currentUser) {
          setUser(currentUser as User);
        } else {
          setUser(null);
        }
      } catch (error) {
        console.error("[auth] session check failed:", error);
      } finally {
        setIsLoading(false);
      }
    }
    checkAuth();
  }, []);

  const login = async (email: string, password: string): Promise<LoginResult> => {
    setIsLoading(true);
    try {
      const loggedInUser = await api.login(email, password);
      setUser(loggedInUser as User);
      
      // Purge any cached data from a previous session (possibly a different
      // tenant on a shared device) before loading data for the new session.
      // invalidateQueries alone is not enough: it only refetches currently
      // mounted queries, so unmounted query keys like ["/api/clinicians"]
      // could still serve stale cross-tenant data from cache until something
      // else happened to refetch them.
      queryClient.clear();
      
      // Redirect based on role
      if (loggedInUser.role === "clinician") {
        setLocation("/availability");
      } else {
        setLocation("/");
      }
      
      return { success: true };
    } catch (error) {
      console.error("Login failed:", error);
      const failure = api.classifyLoginFailure(error);
      return { success: false, ...failure };
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await api.logout();
      setUser(null);
      // Purge all cached data so nothing from this session (client details,
      // clinician availability, etc.) can leak into whichever account logs
      // in next on this device.
      queryClient.clear();
      setLocation("/login");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const refreshUser = async () => {
    try {
      const currentUser = await api.getCurrentUser();
      if (currentUser) {
        setUser(currentUser as User);
      } else {
        console.info("[auth] session expired during refresh; clearing tenant cache");
        setUser(null);
        queryClient.clear();
        setLocation("/login");
      }
    } catch (error) {
      console.error("[auth] failed to refresh session:", error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, refreshUser, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within a AuthProvider");
  }
  return context;
}
