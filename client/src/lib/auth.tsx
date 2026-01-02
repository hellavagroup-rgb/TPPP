import { createContext, useContext, useState, ReactNode, useEffect } from "react";
import { useLocation } from "wouter";
import { useData } from "./mockData";

export type UserRole = "admin" | "clinician";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar?: string;
}

interface AuthContextType {
  user: User | null;
  login: (email: string) => Promise<boolean>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(false); // fast mock load
  const [location, setLocation] = useLocation();
  const { clinicians } = useData();

  const login = async (email: string): Promise<boolean> => {
    setIsLoading(true);
    
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 600));

    if (email.toLowerCase() === "admin@perinatalpsych.com") {
      const adminUser: User = {
        id: "admin-1",
        name: "Admin User",
        email: "admin@perinatalpsych.com",
        role: "admin",
        avatar: "AD"
      };
      setUser(adminUser);
      localStorage.setItem("mock_auth_user", JSON.stringify(adminUser));
      setIsLoading(false);
      setLocation("/");
      return true;
    }

    // Check against mock clinicians (simulating email lookup)
    // For mock purposes, we'll assume email is firstname.lastname@perinatalpsych.com if not in real data
    // But let's just use the clinician ID mapping or a simple match for now.
    // Actually, let's just match against names for the mock if we don't have emails in mockData
    // In mockData, clinicians don't have emails yet. Let's assume a pattern or just match ID if passed.
    
    // Better: Let's assume the user enters "emily@perinatalpsych.com" for Dr. Emily Chen
    const clinician = clinicians.find(c => 
        c.name.toLowerCase().includes(email.split('@')[0].toLowerCase()) || 
        email === `c${c.id}@test.com` // fallback for easier testing
    );

    if (clinician) {
        const clinicianUser: User = {
            id: clinician.id,
            name: clinician.name,
            email: email,
            role: "clinician",
            avatar: clinician.avatar
        };
        setUser(clinicianUser);
        localStorage.setItem("mock_auth_user", JSON.stringify(clinicianUser));
        setIsLoading(false);
        setLocation("/availability"); // Clinicians land on availability
        return true;
    }

    setIsLoading(false);
    return false;
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem("mock_auth_user");
    setLocation("/login");
  };

  // Restore session on load
  useEffect(() => {
    const stored = localStorage.getItem("mock_auth_user");
    if (stored) {
        try {
            setUser(JSON.parse(stored));
        } catch (e) {
            console.error("Failed to parse auth user", e);
        }
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
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
