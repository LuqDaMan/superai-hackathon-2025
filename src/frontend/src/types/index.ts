// User types
export interface User {
  id: string;
  email: string;
  name?: string;
  role: string;
}

// Gap types
export interface Gap {
  gapId: string;
  title: string;
  description: string;
  regulatoryReference: string;
  internalPolicyRef: string;
  gapType: 'missing_requirement' | 'inconsistency' | 'insufficient_control' | 'outdated_policy';
  severity: 'critical' | 'high' | 'medium' | 'low';
  riskLevel: 'high' | 'medium' | 'low';
  impactDescription: string;
  recommendedAction: string;
  status: 'identified' | 'acknowledged' | 'resolved';
  createdAt: string;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  notes?: string;
}

// Amendment types
export interface Amendment {
  amendmentId: string;
  gapId: string;
  amendmentType: 'policy_update' | 'new_policy_section' | 'procedure_addition' | 'control_enhancement';
  targetPolicy: string;
  amendmentTitle: string;
  amendmentText: string;
  rationale: string;
  implementationNotes: string;
  complianceMonitoring: string;
  effectiveDateRecommendation: string;
  priority: 'immediate' | 'high' | 'medium' | 'low';
  status: 'draft' | 'approved' | 'implemented';
  version: string;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
  approvalNotes?: string;
}

// API Response types
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
}

export interface GapsResponse {
  gaps: Gap[];
  total: number;
  filters: {
    status?: string;
    severity?: string;
    regulationId?: string;
  };
  timestamp: string;
}

export interface AmendmentsResponse {
  amendments: Amendment[];
  total: number;
  filters: {
    gapId?: string;
    status?: string;
  };
  timestamp: string;
}

// WebSocket message types
export interface WebSocketMessage {
  type: 'connection' | 'update' | 'error' | 'subscription' | 'pong';
  status?: string;
  message?: string;
  topic?: string;
  data?: any;
  timestamp: string;
}

// Analysis types
export interface AnalysisRequest {
  queryText: string;
  searchType: 'vector' | 'text' | 'hybrid';
  size: number;
  analysisContext?: string;
}

export interface AnalysisResponse {
  message: string;
  executionArn: string;
  requestId: string;
  timestamp: string;
}

// Form types
export interface AcknowledgeGapForm {
  acknowledgedBy: string;
  notes: string;
}

export interface ApproveAmendmentForm {
  approvedBy: string;
  approvalNotes: string;
}

// Filter types
export interface GapFilters {
  status?: string;
  severity?: string;
  regulationId?: string;
  limit?: number;
}

export interface AmendmentFilters {
  gapId?: string;
  status?: string;
  limit?: number;
}

// Notification types
export interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}
