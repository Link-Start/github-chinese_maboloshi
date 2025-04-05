#!/bin/bash

while getopts ":T:A:R:B:P:F:D:h:b:" opt; do
    case $opt in
        T)
            # 通过 GitHub GraphQL API 进行身份验证的 TOKEN
            # TOKEN for authentication via the GitHub GraphQL API
            TOKEN="$OPTARG" ;;
        A)
            # 自定义 GraphQL API 端点
            # Customize GraphQL API endpoints
            GRAPHQL_API_URL="$OPTARG" ;;
        R)
            # GitHub GraphQL API 请求带有所有者的远程仓库名称
            # Remote repository name with owner requested by the GitHub GraphQL API
            repoNwo="$OPTARG" ;;
        B)
            # GitHub GraphQL API 请求的远程仓库目标分支名称
            # The name of the target branch of the remote repository requested by the GitHub GraphQL API
            branch="$OPTARG" ;;
        P)
            # 远程仓库目标分支上最后一次提交的 SHA。
            # 它也是即将创建的提交的父提交的 SHA。
            # The SHA of the last commit on the target branch of the remote repository.
            # It is also the SHA of the parent commit of the commit about to be created.
            parentSHA="$OPTARG" ;;
        F)
            # 通过 GitHub GraphQL API 提交, 新增或修改的文件的路径（相对于存储库根）的数组
            # Array of paths (relative to the repository root) to new or modified files for commits via the GitHub GraphQL API
            #
            # 使用逗号和或空格作为分隔符，将参数分割为数组，默认值为空字符串
            # Split parameters into arrays using commas and or spaces as separators, defaults to empty string
            IFS=', ' read -ra changed_files <<< "$OPTARG" ;;
        D)
            # 通过 GitHub GraphQL API 提交, 删除的文件的路径（相对于存储库根）的数组
            # Array of paths (relative to the repository root) to deleted files for commits via the GitHub GraphQL API
            IFS=', ' read -ra deleted_files <<< "$OPTARG" ;;
        h)
            # 通过 GitHub GraphQL API 提交的提交消息标题行
            # Commit message head line committed via GitHub GraphQL API
            message_headline="$OPTARG" ;;
        b)
            # 通过 GitHub GraphQL API 提交的提交消息正文
            # Commit message body committed via GitHub GraphQL API
            message_body="$OPTARG" ;;
        \?)
           echo "无效的选项: -$OPTARG" >&2; exit 1 ;;
    esac
done

export GITHUB_TOKEN="${TOKEN:-$GITHUB_TOKEN}"
export GITHUB_GRAPHQL_URL="${GRAPHQL_API_URL:-$GITHUB_GRAPHQL_URL}"

signature() {
    if [[ $GITHUB_TOKEN == ghp_* ]]; then
        # https://github.blog/2021-04-05-behind-githubs-new-authentication-token-formats/
        # 'ghp_'开头的是 GitHub 个人访问令牌
        # What starts with 'ghp_' is the GitHub personal access token

        res=$(gh api /user 2>/dev/null || echo '{"login":"gh-actions","id":0}')
    else
        bot="${APP_SLUG:-github-actions}[bot]"
        res=$(gh api "/users/${bot}" 2>/dev/null || echo '{"login":"gh-actions","id":0}')
    fi

    login=$(jq -r .login <<< "$res")
    id=$(jq -r .id <<< "$res")
    echo "Signed-off-by: $login <$id+$login@users.noreply.github.com>"
}

# 构建请求参数
args=(
    -F githubRepository="$repoNwo"
    -F branchName="$branch"
    -F expectedHeadOid="$parentSHA"
    -F messageHeadline="$message_headline"
    -F messageBody="${message_body:+$message_body\n}$(signature)"
)

# 处理文件变更
for file in "${changed_files[@]}"; do
    args+=(-F files[][path]="$file" -F files[][contents]=$(base64 -w0 "$file"))
done

for file in "${deleted_files[@]}"; do
    args+=(-F deletions[][path]="$file")
done

# 执行请求
response=$(gh api graphql "${args[@]}" -F query=@".github/api/createCommitOnBranch.gql")

echo "$response" | jq -r '
    if .data?.createCommitOnBranch?.commit?.url then
        "✅ 请求成功，SHA: \(.data.createCommitOnBranch.commit.oid)\nURL: \(.data.createCommitOnBranch.commit.url)",
    elif .errors then
        "❌ 错误列表:\n" + ([.errors[].message] | join("\n- "))
    else
        "⚠️ 未知响应格式: \(.)"
    end'
