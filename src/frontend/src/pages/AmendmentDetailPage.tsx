import React from 'react';
import { useParams } from 'react-router-dom';

const AmendmentDetailPage: React.FC = () => {
  const { amendmentId } = useParams<{ amendmentId: string }>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Amendment Details</h1>
        <p className="mt-1 text-sm text-gray-500">
          Detailed view of amendment: {amendmentId}
        </p>
      </div>
      
      <div className="card">
        <p className="text-gray-600">Amendment detail page implementation coming soon...</p>
      </div>
    </div>
  );
};

export default AmendmentDetailPage;
