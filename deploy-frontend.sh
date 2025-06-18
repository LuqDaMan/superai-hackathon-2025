#!/bin/bash

# CompliAgent-SG Frontend Deployment Script

set -e

echo "🚀 CompliAgent-SG Frontend Deployment"
echo "======================================"

# Configuration
FRONTEND_DIR="/Users/luqman/Desktop/superai_h/src/frontend"
PROJECT_ROOT="/Users/luqman/Desktop/superai_h"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check Node.js
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version)
        log_success "Node.js found: $NODE_VERSION"
    else
        log_error "Node.js not found. Please install Node.js 18+"
        exit 1
    fi
    
    # Check npm
    if command -v npm &> /dev/null; then
        NPM_VERSION=$(npm --version)
        log_success "npm found: $NPM_VERSION"
    else
        log_error "npm not found. Please install npm"
        exit 1
    fi
    
    # Check AWS CLI
    if command -v aws &> /dev/null; then
        AWS_VERSION=$(aws --version)
        log_success "AWS CLI found: $AWS_VERSION"
    else
        log_warning "AWS CLI not found. Install for deployment features"
    fi
    
    # Check if frontend directory exists
    if [ -d "$FRONTEND_DIR" ]; then
        log_success "Frontend directory found"
    else
        log_error "Frontend directory not found: $FRONTEND_DIR"
        exit 1
    fi
}

# Install dependencies
install_dependencies() {
    log_info "Installing dependencies..."
    
    cd "$FRONTEND_DIR"
    
    if [ -f "package.json" ]; then
        npm install
        log_success "Dependencies installed"
    else
        log_error "package.json not found"
        exit 1
    fi
}

# Setup environment
setup_environment() {
    log_info "Setting up environment..."
    
    cd "$FRONTEND_DIR"
    
    if [ ! -f ".env" ]; then
        if [ -f ".env.example" ]; then
            cp .env.example .env
            log_warning "Created .env from .env.example"
            log_warning "Please update .env with your AWS configuration"
        else
            log_error ".env.example not found"
            exit 1
        fi
    else
        log_success "Environment file exists"
    fi
}

# Build application
build_application() {
    log_info "Building application..."
    
    cd "$FRONTEND_DIR"
    
    # Clean previous build
    if [ -d "dist" ]; then
        rm -rf dist
        log_info "Cleaned previous build"
    fi
    
    # Build
    npm run build
    
    if [ -d "dist" ]; then
        log_success "Build completed successfully"
    else
        log_error "Build failed - dist directory not created"
        exit 1
    fi
}

# Test build
test_build() {
    log_info "Testing build..."
    
    cd "$FRONTEND_DIR"
    
    # Check if key files exist
    if [ -f "dist/index.html" ]; then
        log_success "index.html found"
    else
        log_error "index.html not found in build"
        exit 1
    fi
    
    # Check assets directory
    if [ -d "dist/assets" ]; then
        log_success "Assets directory found"
    else
        log_error "Assets directory not found in build"
        exit 1
    fi
    
    # Get build size
    BUILD_SIZE=$(du -sh dist | cut -f1)
    log_success "Build size: $BUILD_SIZE"
}

# Deploy to AWS Amplify (if configured)
deploy_amplify() {
    log_info "Checking AWS Amplify deployment..."
    
    if command -v aws &> /dev/null; then
        # Check if Amplify app exists
        APP_ID=$(aws amplify list-apps --query 'apps[?name==`CompliAgent-SG-Frontend`].appId' --output text 2>/dev/null || echo "")
        
        if [ -n "$APP_ID" ]; then
            log_info "Found Amplify app: $APP_ID"
            
            read -p "Deploy to AWS Amplify? (y/N): " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                log_info "Deploying to AWS Amplify..."
                aws amplify start-deployment --app-id "$APP_ID" --branch-name main
                log_success "Deployment started"
            fi
        else
            log_warning "No Amplify app found. Create one in AWS Console first."
        fi
    else
        log_warning "AWS CLI not available. Skipping Amplify deployment."
    fi
}

# Deploy to S3 (alternative)
deploy_s3() {
    log_info "S3 deployment option..."
    
    read -p "Deploy to S3 bucket? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        read -p "Enter S3 bucket name: " BUCKET_NAME
        
        if [ -n "$BUCKET_NAME" ]; then
            log_info "Deploying to S3 bucket: $BUCKET_NAME"
            
            cd "$FRONTEND_DIR"
            aws s3 sync dist/ "s3://$BUCKET_NAME" --delete
            
            log_success "Deployed to S3"
            
            # Ask about CloudFront invalidation
            read -p "Invalidate CloudFront cache? Enter distribution ID (or press Enter to skip): " DISTRIBUTION_ID
            
            if [ -n "$DISTRIBUTION_ID" ]; then
                aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*"
                log_success "CloudFront cache invalidated"
            fi
        fi
    fi
}

# Start development server
start_dev_server() {
    log_info "Development server option..."
    
    read -p "Start development server? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        log_info "Starting development server..."
        log_info "Server will be available at http://localhost:5173"
        log_info "Press Ctrl+C to stop"
        
        cd "$FRONTEND_DIR"
        npm run dev
    fi
}

# Main deployment flow
main() {
    echo
    log_info "Starting deployment process..."
    echo
    
    check_prerequisites
    echo
    
    install_dependencies
    echo
    
    setup_environment
    echo
    
    build_application
    echo
    
    test_build
    echo
    
    # Deployment options
    echo "Deployment Options:"
    echo "1. AWS Amplify (recommended)"
    echo "2. S3 + CloudFront"
    echo "3. Start development server"
    echo "4. Exit"
    echo
    
    read -p "Choose deployment option (1-4): " -n 1 -r
    echo
    echo
    
    case $REPLY in
        1)
            deploy_amplify
            ;;
        2)
            deploy_s3
            ;;
        3)
            start_dev_server
            ;;
        4)
            log_info "Exiting..."
            ;;
        *)
            log_warning "Invalid option. Exiting..."
            ;;
    esac
    
    echo
    log_success "Deployment script completed!"
    echo
    log_info "Next steps:"
    echo "  1. Configure environment variables in .env"
    echo "  2. Update AWS resource IDs after backend deployment"
    echo "  3. Test the application thoroughly"
    echo "  4. Set up monitoring and logging"
}

# Run main function
main "$@"
