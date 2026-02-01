
import re

def check_balance(filename):
    with open(filename, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    stack = []
    # 894번 줄부터 검사 (TextExtractionPage 함수 시작)
    start_line = 893 
    
    # 주석 및 문자열 처리를 위한 정규식
    # 단순히 괄호만 세면 문자열/주석 내의 괄호 때문에 오판할 수 있음.
    # 여기서는 간단히 줄 단위로 처리하되, // 주석은 제거하고 계산.
    # /* */ 및 멀티라인 문자열은 복잡하므로 일단 간단한 파서로 접근.

    for i, line in enumerate(lines):
        if i < start_line:
            continue
            
        # 한 줄 내에서 문자열과 주석 제거 (간이)
        clean_line = line
        clean_line = re.sub(r'//.*', '', clean_line) # 한줄 주석 제거
        clean_line = re.sub(r"'[^']*'", "''", clean_line) # 따옴표 문자열 제거
        clean_line = re.sub(r'"[^"]*"', '""', clean_line) # 쌍따옴표 문자열 제거
        # JSX 문자열이나 백틱은 처리가 어렵지만, 일단 주요 구조 괄호 {} () 위주로 봄.

        for char in clean_line:
            if char in '{(':
                stack.append((char, i + 1))
            elif char in '})':
                if not stack:
                    print(f"Error: Extra '{char}' at line {i + 1}")
                    return
                
                last_open, last_line = stack.pop()
                expected_close = '}' if last_open == '{' else ')'
                
                if char != expected_close:
                    print(f"Error: Mismatched '{last_open}' (from line {last_line}) and '{char}' at line {i + 1}")
                    return

    if stack:
        print(f"Error: Unclosed parentheses/braces remaining: {len(stack)}")
        for char, line_num in stack[-5:]: # 마지막 5개만 출력
            print(f"Unclosed '{char}' from line {line_num}")

check_balance('frontend/app/(app)/processing/extract/page.tsx')
