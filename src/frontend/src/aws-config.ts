import { Amplify } from 'aws-amplify';

// AWS Configuration - Update these values after deployment
const awsConfig = {
  Auth: {
    Cognito: {
      region: import.meta.env.VITE_AWS_REGION || 'us-east-1',
      userPoolId: import.meta.env.VITE_USER_POOL_ID || 'your-user-pool-id',
      userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID || 'your-client-id',
      loginWith: {
        email: true,
      },
    }
  }
};

// Configure Amplify
Amplify.configure(awsConfig);

export default awsConfig;
