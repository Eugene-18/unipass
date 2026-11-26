import { createContext, useContext } from 'react';
import type { AdmissionChannelConfig, AdmissionApplication } from '../types';

export type AdmissionContextValue = {
  channelConfig: AdmissionChannelConfig;
  setChannelConfig: (next: AdmissionChannelConfig | ((prev: AdmissionChannelConfig) => AdmissionChannelConfig)) => void;
  applications: AdmissionApplication[];
  setApplications: (next: AdmissionApplication[] | ((prev: AdmissionApplication[]) => AdmissionApplication[])) => void;
};

export const AdmissionContext = createContext<AdmissionContextValue | null>(null);

export function useAdmissionContext() {
  const ctx = useContext(AdmissionContext);
  if (!ctx) throw new Error('useAdmissionContext must be used within AdmissionProvider');
  return ctx;
}
