import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import apiService from '../services/api';
import type { Gap, Amendment } from '../types';
import {
  ExclamationTriangleIcon,
  DocumentTextIcon,
  CheckCircleIcon,
  ClockIcon
} from '@heroicons/react/24/outline';

const DashboardPage: React.FC = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState({
    totalGaps: 0,
    criticalGaps: 0,
    acknowledgedGaps: 0,
    pendingAmendments: 0
  });
  const [recentGaps, setRecentGaps] = useState<Gap[]>([]);
  const [recentAmendments, setRecentAmendments] = useState<Amendment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setIsLoading(true);
      setError('');

      // Load gaps data
      const gapsResponse = await apiService.getGaps({ limit: 10 });
      const gaps = gapsResponse.gaps;
      
      // Load amendments data
      const amendmentsResponse = await apiService.getAmendments({ limit: 5 });
      const amendments = amendmentsResponse.amendments;

      // Calculate stats
      const criticalGaps = gaps.filter(gap => gap.severity === 'critical').length;
      const acknowledgedGaps = gaps.filter(gap => gap.status === 'acknowledged').length;
      const pendingAmendments = amendments.filter(amendment => amendment.status === 'draft').length;

      setStats({
        totalGaps: gaps.length,
        criticalGaps,
        acknowledgedGaps,
        pendingAmendments
      });

      setRecentGaps(gaps.slice(0, 5));
      setRecentAmendments(amendments);

    } catch (error: any) {
      console.error('Error loading dashboard data:', error);
      setError('Failed to load dashboard data');
    } finally {
      setIsLoading(false);
    }
  };

  const getSeverityBadge = (severity: string) => {
    const badges = {
      critical: 'badge-critical',
      high: 'badge-high',
      medium: 'badge-medium',
      low: 'badge-low'
    };
    return badges[severity as keyof typeof badges] || 'badge-medium';
  };

  const getStatusBadge = (status: string) => {
    const badges = {
      identified: 'bg-yellow-100 text-yellow-800',
      acknowledged: 'bg-blue-100 text-blue-800',
      resolved: 'bg-green-100 text-green-800',
      draft: 'bg-gray-100 text-gray-800',
      approved: 'bg-green-100 text-green-800',
      implemented: 'bg-purple-100 text-purple-800'
    };
    return badges[status as keyof typeof badges] || 'bg-gray-100 text-gray-800';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome back, {user?.name || user?.email}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Here's what's happening with your compliance management today.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-4">
          <div className="text-sm text-red-700">{error}</div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <ExclamationTriangleIcon className="h-8 w-8 text-red-400" />
            </div>
            <div className="ml-5 w-0 flex-1">
              <dl>
                <dt className="text-sm font-medium text-gray-500 truncate">
                  Total Gaps
                </dt>
                <dd className="text-lg font-medium text-gray-900">
                  {stats.totalGaps}
                </dd>
              </dl>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <ExclamationTriangleIcon className="h-8 w-8 text-orange-400" />
            </div>
            <div className="ml-5 w-0 flex-1">
              <dl>
                <dt className="text-sm font-medium text-gray-500 truncate">
                  Critical Gaps
                </dt>
                <dd className="text-lg font-medium text-gray-900">
                  {stats.criticalGaps}
                </dd>
              </dl>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <CheckCircleIcon className="h-8 w-8 text-green-400" />
            </div>
            <div className="ml-5 w-0 flex-1">
              <dl>
                <dt className="text-sm font-medium text-gray-500 truncate">
                  Acknowledged
                </dt>
                <dd className="text-lg font-medium text-gray-900">
                  {stats.acknowledgedGaps}
                </dd>
              </dl>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <ClockIcon className="h-8 w-8 text-blue-400" />
            </div>
            <div className="ml-5 w-0 flex-1">
              <dl>
                <dt className="text-sm font-medium text-gray-500 truncate">
                  Pending Amendments
                </dt>
                <dd className="text-lg font-medium text-gray-900">
                  {stats.pendingAmendments}
                </dd>
              </dl>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Gaps and Amendments */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent Gaps */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-gray-900">Recent Gaps</h3>
            <Link
              to="/gaps"
              className="text-sm text-primary-600 hover:text-primary-500"
            >
              View all
            </Link>
          </div>
          <div className="space-y-3">
            {recentGaps.length > 0 ? (
              recentGaps.map((gap) => (
                <div key={gap.gapId} className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {gap.title}
                    </p>
                    <p className="text-xs text-gray-500">
                      {new Date(gap.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getSeverityBadge(gap.severity)}`}>
                      {gap.severity}
                    </span>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(gap.status)}`}>
                      {gap.status}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500">No gaps found</p>
            )}
          </div>
        </div>

        {/* Recent Amendments */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-gray-900">Recent Amendments</h3>
            <Link
              to="/amendments"
              className="text-sm text-primary-600 hover:text-primary-500"
            >
              View all
            </Link>
          </div>
          <div className="space-y-3">
            {recentAmendments.length > 0 ? (
              recentAmendments.map((amendment) => (
                <div key={amendment.amendmentId} className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {amendment.amendmentTitle}
                    </p>
                    <p className="text-xs text-gray-500">
                      {amendment.targetPolicy}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(amendment.status)}`}>
                      {amendment.status}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500">No amendments found</p>
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="card">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Quick Actions</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Link
            to="/gaps"
            className="flex items-center p-4 bg-primary-50 rounded-lg hover:bg-primary-100 transition-colors"
          >
            <ExclamationTriangleIcon className="h-8 w-8 text-primary-600" />
            <div className="ml-4">
              <p className="text-sm font-medium text-primary-900">Review Gaps</p>
              <p className="text-xs text-primary-700">Identify compliance issues</p>
            </div>
          </Link>
          
          <Link
            to="/amendments"
            className="flex items-center p-4 bg-green-50 rounded-lg hover:bg-green-100 transition-colors"
          >
            <DocumentTextIcon className="h-8 w-8 text-green-600" />
            <div className="ml-4">
              <p className="text-sm font-medium text-green-900">Review Amendments</p>
              <p className="text-xs text-green-700">Approve policy changes</p>
            </div>
          </Link>
          
          <button
            onClick={loadDashboardData}
            className="flex items-center p-4 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
          >
            <ClockIcon className="h-8 w-8 text-blue-600" />
            <div className="ml-4">
              <p className="text-sm font-medium text-blue-900">Refresh Data</p>
              <p className="text-xs text-blue-700">Update dashboard</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
