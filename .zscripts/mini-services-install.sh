#!/bin/bash

# 配置项
ROOT_DIR="/home/z/my-project/mini-services"

main() {
    echo "🚀 开始批量安装依赖..."
    
    # 检查 rootdir 是否存在
    if [ ! -d "$ROOT_DIR" ]; then
        echo "ℹ️  目录 $ROOT_DIR 不存在，跳过安装"
        return
    fi
    
    # 统计变量
    success_count=0
    fail_count=0
    failed_projects=""
    
    # 遍历 mini-services 目录下的所有文件夹
    for dir in "$ROOT_DIR"/*; do
        if [ ! -d "$dir" ]; then
            continue
        fi

        project_name=$(basename "$dir")

        # JavaScript/TypeScript mini-service dependencies
        if [ -f "$dir/package.json" ]; then
            echo ""
            echo "📦 正在安装 JS 依赖: $project_name..."
            
            # 进入项目目录并执行 bun install
            if (cd "$dir" && bun install); then
                echo "✅ $project_name 依赖安装成功"
                success_count=$((success_count + 1))
            else
                echo "❌ $project_name 依赖安装失败"
                fail_count=$((fail_count + 1))
                if [ -z "$failed_projects" ]; then
                    failed_projects="$project_name"
                else
                    failed_projects="$failed_projects $project_name"
                fi
            fi
        fi

        # Python/FastAPI mini-service dependencies
        if [ -f "$dir/requirements.txt" ]; then
            echo ""
            echo "🐍 正在安装 Python 依赖: $project_name..."

            python_bin="python3"
            if ! command -v "$python_bin" >/dev/null 2>&1; then
                python_bin="python"
            fi

            if (
                cd "$dir" &&
                "$python_bin" -m venv .venv &&
                . .venv/bin/activate &&
                python -m pip install --upgrade pip &&
                python -m pip install -r requirements.txt
            ); then
                echo "✅ $project_name Python 依赖安装成功"
                success_count=$((success_count + 1))
            else
                echo "❌ $project_name Python 依赖安装失败"
                fail_count=$((fail_count + 1))
                if [ -z "$failed_projects" ]; then
                    failed_projects="$project_name"
                else
                    failed_projects="$failed_projects $project_name"
                fi
            fi
        fi
    done
    
    # 汇总结果
    echo ""
    echo "=================================================="
    if [ $success_count -gt 0 ] || [ $fail_count -gt 0 ]; then
        echo "🎉 安装完成！"
        echo "✅ 成功: $success_count 个"
        if [ $fail_count -gt 0 ]; then
            echo "❌ 失败: $fail_count 个"
            echo ""
            echo "失败的项目:"
            for project in $failed_projects; do
                echo "  - $project"
            done
        fi
    else
        echo "ℹ️  未找到任何包含 package.json 的项目"
    fi
    echo "=================================================="
}

main
