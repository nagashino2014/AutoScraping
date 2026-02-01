
import re
import os

def check_function_end(filename):
    if not os.path.exists(filename):
        print("File not found!")
        return

    with open(filename, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    stack = []
    start_line = 893 # 0-based, line 894 in file
    
    in_block_comment = False
    
    function_brace_opened = False
    function_brace_idx = -1

    for i, line in enumerate(lines):
        if i < start_line:
            continue
            
        idx = 0
        while idx < len(line):
            char = line[idx]
            
            if in_block_comment:
                if line[idx:idx+2] == '*/':
                    in_block_comment = False
                    idx += 1
                idx += 1
                continue
            
            if line[idx:idx+2] == '/*':
                in_block_comment = True
                idx += 2
                continue
                
            if line[idx:idx+2] == '//':
                break
            
            if char in '{(':
                stack.append((char, i + 1))
                if not function_brace_opened and char == '{':
                    function_brace_opened = True
                    function_brace_idx = len(stack) - 1 # 스택에서의 인덱스
                    print(f"Function body started at line {i + 1}")
            elif char in '})':
                if stack:
                    last_open, last_line = stack.pop()
                    if function_brace_opened and len(stack) == function_brace_idx:
                        # 스택이 함수 시작 괄호 직전 상태로 돌아왔다면, 방금 팝한게 함수 닫는 괄호?
                        # 아니, stack.append하고 pop했으므로, 현재 stack 길이가 function_brace_idx와 같으면 
                        # 방금 닫힌 괄호가 함수 본문을 닫는 괄호임.
                        # 정확히는 stack이 비어야 함 (함수 시작 전 스택 상태).
                        # 여기서는 함수 시작부터 체크하므로 stack이 비면 함수 끝.
                        pass

                    if not stack and function_brace_opened:
                        print(f"Function body CLOSED at line {i + 1}")
                        # 함수가 닫힌 후에도 코드가 계속되면 문제
                        # return
                else:
                    print(f"Error: Extra '{char}' at line {i + 1}")

            idx += 1
            
    print(f"Scan finished. Final stack size: {len(stack)}")

check_function_end('app/(app)/processing/extract/page.tsx')
