import axios from 'axios';
import type { AxiosInstance } from 'axios';
import { fetchAuthSession } from 'aws-amplify/auth';
import type {
  Gap,
  Amendment,
  GapsResponse,
  AmendmentsResponse,
  AnalysisRequest,
  AnalysisResponse,
  AcknowledgeGapForm,
  ApproveAmendmentForm,
  GapFilters,
  AmendmentFilters
} from '../types';

class ApiService {
  private api: AxiosInstance;
  private baseURL: string;

  constructor() {
    this.baseURL = import.meta.env.VITE_API_ENDPOINT || 'https://your-api-id.execute-api.region.amazonaws.com/prod';
    
    this.api = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request interceptor to include auth token
    this.api.interceptors.request.use(
      async (config) => {
        try {
          const session = await fetchAuthSession();
          const token = session.tokens?.accessToken?.toString();
          if (token) {
            config.headers.Authorization = `Bearer ${token}`;
          }
        } catch (error) {
          console.warn('No auth session found:', error);
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Add response interceptor for error handling
    this.api.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401) {
          // Token expired or invalid, redirect to login
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    );
  }

  // Health check
  async healthCheck(): Promise<any> {
    const response = await this.api.get('/health');
    return response.data;
  }

  // Gap management
  async getGaps(filters: GapFilters = {}): Promise<GapsResponse> {
    const params = new URLSearchParams();
    
    if (filters.status) params.append('status', filters.status);
    if (filters.severity) params.append('severity', filters.severity);
    if (filters.regulationId) params.append('regulationId', filters.regulationId);
    if (filters.limit) params.append('limit', filters.limit.toString());

    const response = await this.api.get(`/gaps?${params.toString()}`);
    return response.data;
  }

  async acknowledgeGap(gapId: string, data: AcknowledgeGapForm): Promise<any> {
    const response = await this.api.post(`/gaps/${gapId}/acknowledge`, data);
    return response.data;
  }

  // Amendment management
  async getAmendments(filters: AmendmentFilters = {}): Promise<AmendmentsResponse> {
    const params = new URLSearchParams();
    
    if (filters.gapId) params.append('gapId', filters.gapId);
    if (filters.status) params.append('status', filters.status);
    if (filters.limit) params.append('limit', filters.limit.toString());

    const response = await this.api.get(`/amendments?${params.toString()}`);
    return response.data;
  }

  async approveAmendment(amendmentId: string, data: ApproveAmendmentForm): Promise<any> {
    const response = await this.api.post(`/amendments/${amendmentId}/approve`, data);
    return response.data;
  }

  // Analysis workflows
  async startGapAnalysis(request: AnalysisRequest): Promise<AnalysisResponse> {
    const response = await this.api.post('/analysis/start', request);
    return response.data;
  }

  async draftAmendments(gapIds: string[], organizationContext?: string): Promise<any> {
    const response = await this.api.post('/amendments/draft', {
      gapIds,
      organizationContext
    });
    return response.data;
  }

  // Utility methods
  getApiEndpoint(): string {
    return this.baseURL;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.healthCheck();
      return true;
    } catch (error) {
      console.error('API connection test failed:', error);
      return false;
    }
  }
}

// Create singleton instance
const apiService = new ApiService();

export default apiService;
