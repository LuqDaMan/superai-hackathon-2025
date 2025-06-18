#!/usr/bin/env python3
"""
Test script for CompliAgent-SG Frontend
"""

import subprocess
import time
import requests
import os
from pathlib import Path

def test_frontend():
    """Test the frontend application"""
    
    print("🧪 Testing CompliAgent-SG Frontend")
    print("=" * 60)
    
    frontend_dir = Path("/Users/luqman/Desktop/superai_h/src/frontend")
    
    # Test 1: Check if build artifacts exist
    print("\n1. Checking Build Artifacts...")
    
    dist_dir = frontend_dir / "dist"
    if dist_dir.exists():
        print(f"   ✅ Build directory exists: {dist_dir}")
        
        # Check for key files
        key_files = ["index.html", "assets"]
        for file_name in key_files:
            file_path = dist_dir / file_name
            if file_path.exists():
                print(f"   ✅ {file_name}: Found")
            else:
                print(f"   ❌ {file_name}: Missing")
    else:
        print(f"   ❌ Build directory not found: {dist_dir}")
        print("   💡 Run 'npm run build' first")
    
    # Test 2: Check package.json and dependencies
    print("\n2. Checking Package Configuration...")
    
    package_json = frontend_dir / "package.json"
    if package_json.exists():
        print(f"   ✅ package.json exists")
        
        # Check if node_modules exists
        node_modules = frontend_dir / "node_modules"
        if node_modules.exists():
            print(f"   ✅ Dependencies installed")
        else:
            print(f"   ❌ Dependencies not installed")
            print("   💡 Run 'npm install' first")
    else:
        print(f"   ❌ package.json not found")
    
    # Test 3: Check TypeScript configuration
    print("\n3. Checking TypeScript Configuration...")
    
    ts_configs = ["tsconfig.json", "tsconfig.app.json", "tsconfig.node.json"]
    for config in ts_configs:
        config_path = frontend_dir / config
        if config_path.exists():
            print(f"   ✅ {config}: Found")
        else:
            print(f"   ❌ {config}: Missing")
    
    # Test 4: Check Tailwind CSS configuration
    print("\n4. Checking Tailwind CSS Configuration...")
    
    tailwind_config = frontend_dir / "tailwind.config.js"
    postcss_config = frontend_dir / "postcss.config.js"
    
    if tailwind_config.exists():
        print(f"   ✅ tailwind.config.js: Found")
    else:
        print(f"   ❌ tailwind.config.js: Missing")
    
    if postcss_config.exists():
        print(f"   ✅ postcss.config.js: Found")
    else:
        print(f"   ❌ postcss.config.js: Missing")
    
    # Test 5: Check source code structure
    print("\n5. Checking Source Code Structure...")
    
    src_dir = frontend_dir / "src"
    expected_dirs = ["components", "pages", "contexts", "services", "types"]
    expected_files = ["App.tsx", "main.tsx", "index.css", "aws-config.ts"]
    
    for dir_name in expected_dirs:
        dir_path = src_dir / dir_name
        if dir_path.exists():
            print(f"   ✅ {dir_name}/: Found")
        else:
            print(f"   ❌ {dir_name}/: Missing")
    
    for file_name in expected_files:
        file_path = src_dir / file_name
        if file_path.exists():
            print(f"   ✅ {file_name}: Found")
        else:
            print(f"   ❌ {file_name}: Missing")
    
    # Test 6: Check environment configuration
    print("\n6. Checking Environment Configuration...")
    
    env_example = frontend_dir / ".env.example"
    env_file = frontend_dir / ".env"
    
    if env_example.exists():
        print(f"   ✅ .env.example: Found")
    else:
        print(f"   ❌ .env.example: Missing")
    
    if env_file.exists():
        print(f"   ✅ .env: Found")
    else:
        print(f"   ⚠️  .env: Not found (optional)")
        print("   💡 Copy .env.example to .env and configure values")
    
    # Test 7: Test build process
    print("\n7. Testing Build Process...")
    
    try:
        os.chdir(frontend_dir)
        result = subprocess.run(
            ["npm", "run", "build"],
            capture_output=True,
            text=True,
            timeout=120
        )
        
        if result.returncode == 0:
            print("   ✅ Build successful")
        else:
            print("   ❌ Build failed")
            print(f"   Error: {result.stderr}")
    except subprocess.TimeoutExpired:
        print("   ❌ Build timed out")
    except Exception as e:
        print(f"   ❌ Build error: {str(e)}")
    
    # Test 8: Check AWS Amplify configuration
    print("\n8. Checking AWS Amplify Configuration...")
    
    amplify_yml = frontend_dir / "amplify.yml"
    if amplify_yml.exists():
        print(f"   ✅ amplify.yml: Found")
    else:
        print(f"   ❌ amplify.yml: Missing")
    
    print("\n" + "=" * 60)
    print("🏁 Frontend Test Complete")
    print("\n💡 Next steps to run the frontend:")
    print("   1. Configure environment variables in .env")
    print("   2. Start development server: npm run dev")
    print("   3. Deploy to AWS Amplify for production")
    print("\n🔧 Development commands:")
    print("   # Start dev server")
    print("   cd src/frontend && npm run dev")
    print("   # Build for production")
    print("   cd src/frontend && npm run build")
    print("   # Preview production build")
    print("   cd src/frontend && npm run preview")

def start_dev_server():
    """Start the development server"""
    print("\n🚀 Starting Development Server...")
    
    frontend_dir = Path("/Users/luqman/Desktop/superai_h/src/frontend")
    
    try:
        os.chdir(frontend_dir)
        print("   Starting server on http://localhost:5173")
        print("   Press Ctrl+C to stop")
        
        subprocess.run(["npm", "run", "dev"], check=True)
    except KeyboardInterrupt:
        print("\n   Server stopped")
    except Exception as e:
        print(f"   ❌ Error starting server: {str(e)}")

if __name__ == "__main__":
    test_frontend()
    
    # Ask if user wants to start dev server
    start_server = input("\nDo you want to start the development server? (y/N): ")
    if start_server.lower() == 'y':
        start_dev_server()
