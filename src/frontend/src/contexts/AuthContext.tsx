import React, { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { signIn, signUp, signOut, confirmSignUp, resendSignUpCode, resetPassword, confirmResetPassword, getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';
import type { User } from '../types';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name?: string) => Promise<void>;
  signOut: () => Promise<void>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  resendConfirmationCode: (email: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  confirmPassword: (email: string, code: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkAuthState();
  }, []);

  const checkAuthState = async () => {
    try {
      setIsLoading(true);
      const currentUser = await getCurrentUser();
      const userInfo = await getUserInfo(currentUser);
      setUser(userInfo);
    } catch (error) {
      console.log('No authenticated user found');
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  const getUserInfo = async (cognitoUser: any): Promise<User> => {
    const attributes = cognitoUser.signInDetails?.loginId || cognitoUser.username;
    return {
      id: cognitoUser.userId || cognitoUser.username,
      email: attributes,
      name: attributes,
      role: 'user'
    };
  };

  const handleSignIn = async (email: string, password: string): Promise<void> => {
    try {
      setIsLoading(true);
      const result = await signIn({ username: email, password });
      
      if (result.isSignedIn) {
        const currentUser = await getCurrentUser();
        const userInfo = await getUserInfo(currentUser);
        setUser(userInfo);
      }
    } catch (error: any) {
      console.error('Sign in error:', error);
      throw new Error(error.message || 'Sign in failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignUp = async (email: string, password: string, name?: string): Promise<void> => {
    try {
      setIsLoading(true);
      const attributes: any = {
        email,
      };
      
      if (name) {
        attributes.name = name;
      }

      await signUp({
        username: email,
        password,
        options: {
          userAttributes: attributes
        }
      });
    } catch (error: any) {
      console.error('Sign up error:', error);
      throw new Error(error.message || 'Sign up failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = async (): Promise<void> => {
    try {
      setIsLoading(true);
      await signOut();
      setUser(null);
    } catch (error: any) {
      console.error('Sign out error:', error);
      throw new Error(error.message || 'Sign out failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmSignUp = async (email: string, code: string): Promise<void> => {
    try {
      setIsLoading(true);
      await confirmSignUp({ username: email, confirmationCode: code });
    } catch (error: any) {
      console.error('Confirm sign up error:', error);
      throw new Error(error.message || 'Confirmation failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendConfirmationCode = async (email: string): Promise<void> => {
    try {
      await resendSignUpCode({ username: email });
    } catch (error: any) {
      console.error('Resend confirmation error:', error);
      throw new Error(error.message || 'Resend failed');
    }
  };

  const handleForgotPassword = async (email: string): Promise<void> => {
    try {
      await resetPassword({ username: email });
    } catch (error: any) {
      console.error('Forgot password error:', error);
      throw new Error(error.message || 'Password reset failed');
    }
  };

  const handleConfirmPassword = async (email: string, code: string, newPassword: string): Promise<void> => {
    try {
      setIsLoading(true);
      await confirmResetPassword({ username: email, confirmationCode: code, newPassword });
    } catch (error: any) {
      console.error('Confirm password error:', error);
      throw new Error(error.message || 'Password confirmation failed');
    } finally {
      setIsLoading(false);
    }
  };

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated: !!user,
    signIn: handleSignIn,
    signUp: handleSignUp,
    signOut: handleSignOut,
    confirmSignUp: handleConfirmSignUp,
    resendConfirmationCode: handleResendConfirmationCode,
    forgotPassword: handleForgotPassword,
    confirmPassword: handleConfirmPassword
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
