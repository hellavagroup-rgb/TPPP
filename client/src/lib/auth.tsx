import { createContext, useContext, useState, ReactNode, useEffect } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import * as api from "./api";
import type { SafeUser } from "@shared/schema";

export type UserRole = "admin" | "clinician";

export interface NotificationPrefs {
  newReferrals?: boolean;
  waitlistUpdates?: boolean;
  taskAssignments?: boolean;
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
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();

  // Check if user is already logged in on mount
  useEffect(() => {
    async function checkAuth() {
      try {
        const currentUser = await api.getCurrentUser();
        if (currentUser) {
          setUser(currentUser as User);
        }
      } catch (error) {
        console.error("Auth check failed:", error);
      } finally {
        setIsLoading(false);
      }
    }
    checkAuth();
  }, []);

  const login = async (email: string, password: string): Promise<boolean> => {
    setIsLoading(true);
    try {
      const loggedInUser = await api.login(email, password);
      setUser(loggedInUser as User);
      
      // Invalidate all queries so they refetch with the new session
      await queryClient.invalidateQueries();
      
      // Redirect based on role
      if (loggedInUser.role === "clinician") {
        setLocation("/availability");
      } else {
        setLocation("/");
      }
      
      return true;
    } catch (error) {
      console.error("Login failed:", error);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await api.logout();
      setUser(null);
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
      }
    } catch (error) {
      console.error("Failed to refresh user:", error);
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
