import React from 'react';
import { AdmissionContext, type AdmissionContextValue } from './admissionContextCore';

export function AdmissionProvider({ value, children }: { value: AdmissionContextValue; children: React.ReactNode }) {
  return <AdmissionContext.Provider value={value}>{children}</AdmissionContext.Provider>;
}
