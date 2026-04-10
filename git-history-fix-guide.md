# Git 커밋 내역(Author/Email) 일괄 수정 및 다중 계정 관리 가이드

이 문서는 다른 컴퓨터나 다른 계정으로 잘못 커밋된 내역들을 새로운 이름/이메일로 덮어쓰고, 추후 동일한 사고가 발생하지 않도록 방지하는 시니어 레벨의 Git 관리 방법론을 담고 있습니다. 다른 프로젝트에서도 동일하게 발생할 때 이 문서를 참고하여 해결하세요.

---

## 🚨 1. 앞으로 추가될 커밋의 작성자 정보 수정하기

가장 먼저 할 일은, 지금 당장 내 컴퓨터에 설정된 잘못된 이름과 이메일을 올바르게 고치는 것입니다. 그렇지 않으면 앞으로 생성할 커밋도 계속 잘못된 이름으로 기록됩니다.

터미널(PowerShell 또는 Bash)을 열고 아래 명령어를 입력합니다. (단, 해당 프로젝트의 최상위 폴더 위치에서 실행해야 합니다.)

```powershell
# 이름 변경
git config user.name "올바른 내 이름"

# 이메일 변경 (반드시 GitHub에 등록된 이메일을 써야 잔디가 심어집니다)
git config user.email "올바른내이메일@gmail.com"
```
> [!NOTE]
> 만약 `--global` 옵션을 주면 내 컴퓨터의 "모든 프로젝트" 기본값이 바뀝니다. 특정 프로젝트만 바꾸고 싶다면 `--global`을 빼고 입력하세요.

---

## 🚮 2. 과거의 모든 커밋 내역 일괄 변경 (History 조작)

이미 잘못된 이름으로 `commit` 된 과거의 내역들을 전부 덮어씌우려면 역사를 조작하는 `git filter-branch` 명령을 써야 합니다.

**⚠️ 주의 및 필수 조건:** 
* 반드시 프로젝트의 **최상위 루트 폴더** (예: `backend` 폴더 최상단)에서 실행해야 합니다! (`dist` 같은 하위 폴더에서 실행하면 오류가 발생합니다.)

### 실행 스크립트 (PowerShell 복사/붙여넣기 전용)
아래의 코드에서 `OLD_EMAIL`, `CORRECT_NAME`, `CORRECT_EMAIL` 3개의 따옴표 안 내용만 본인의 상황에 맞게 수정한 후, **전체를 한 줄로 쭈욱 복사해서 터미널에 붙여넣고 엔터**를 치세요.

```powershell
git filter-branch -f --env-filter 'OLD_EMAIL="잘못들어간이메일@example.com"; CORRECT_NAME="올바른새이름"; CORRECT_EMAIL="올바른새이메일@gmail.com"; if [ "$GIT_COMMITTER_EMAIL" = "$OLD_EMAIL" ]; then export GIT_COMMITTER_NAME="$CORRECT_NAME"; export GIT_COMMITTER_EMAIL="$CORRECT_EMAIL"; fi; if [ "$GIT_AUTHOR_EMAIL" = "$OLD_EMAIL" ]; then export GIT_AUTHOR_NAME="$CORRECT_NAME"; export GIT_AUTHOR_EMAIL="$CORRECT_EMAIL"; fi' --tag-name-filter cat -- --branches --tags
```
> *작업이 수십 초 정도 진행되며 과거의 커밋들이 전부 새로 갱신됩니다.*

---

## 🚀 3. GitHub에 강제 덮어쓰기 (중요)

로컬의 역사를 바꿨기 때문에, 깃허브에는 그냥 `git push`를 할 수 없습니다. (에러 발생)
내 로컬 컴퓨터의 조작된 역사가 "진짜"라고 강제로 우기며 원격 서버에 덮어씌워야 합니다.

```powershell
git push --force
```

> [!WARNING]
> **팀 프로젝트 시 주의사항**
> `git push --force`는 협업 중인 다른 팀원의 Git을 완전히 꼬이게 만들 수 있는 매우 위험한 명령어입니다. 오직 혼자 진행하는 개인 프로젝트이거나, 팀원들과 사전에 완벽히 협의가 끝난 상태에서만 사용하세요.

---

## 💡 시니어 아키텍트의 관점: `includeIf`를 통한 영구적 사고 방지

실무에서는 개인 포트폴리오(개인 이메일)와 회사 업무용(회사 이메일) 프로젝트를 한 노트북에서 동시에 다루게 됩니다. 깜빡하고 이메일 설정을 안 바꾸면 회삿일 커밋이 개인 깃허브로 들어가버리는 대참사가 일어납니다.

이를 방지하기 위해 **폴더 경로별로 Git 계정을 자동으로 갈아끼우는 `includeIf` 설정**을 꼭 적용해 보세요.

### 설정 방법
1. 내 컴퓨터의 전역 Git 설정 파일(`~/.gitconfig` 또는 `C:\Users\내이름\.gitconfig`)을 엽니다.
2. 아래처럼 작성합니다.

```ini
# (기본값) 일반적인 모든 폴더에서는 내 개인 계정을 쓴다.
[user]
    name = Personal Name
    email = personal@gmail.com

# (조건부) 하지만 회사 코드가 담긴 C:/WorkSpace/ 폴더 안에서 작업할 때만 아래의 설정을 덮어씌운다!
[includeIf "gitdir:C:/WorkSpace/"]
    path = ~/work.gitconfig
```

3. 그리고 `~/work.gitconfig` 이라는 파일을 하나 새로 만들고 내용은 아래처럼 적어줍니다.

```ini
[user]
    name = Company Name
    email = name@company.com
```

이렇게 세팅해 두면, 특정 폴더(예: 회사 폴더)에 들어가는 순간 Git이 알아서 회사 이메일로 커밋을 진행하므로 평생 계정이 꼬이는 사고를 원천 차단할 수 있습니다!


1---
git filter-branch -f --env-filter 'OLD_EMAIL="shuw75@gmail.com"; CORRECT_NAME="yoonjinwoo"; CORRECT_EMAIL="yjw3647@gmail.com"; if [ "$GIT_COMMITTER_EMAIL" = "$OLD_EMAIL" ]; then export GIT_COMMITTER_NAME="$CORRECT_NAME"; export GIT_COMMITTER_EMAIL="$CORRECT_EMAIL"; fi; if [ "$GIT_AUTHOR_EMAIL" = "$OLD_EMAIL" ]; then export GIT_AUTHOR_NAME="$CORRECT_NAME"; export GIT_AUTHOR_EMAIL="$CORRECT_EMAIL"; fi' --tag-name-filter cat -- --branches --tags

2---
git push --force