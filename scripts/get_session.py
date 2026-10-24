"""Hermes Overlay — Get session bridge.

Invoked by the Electron main process to fetch messages for a specific session 
from the Hermes backend SQLite store (state.db).

Outputs a JSON array of messages formatted for the overlay frontend.
Applies the SAME formatting as the live streaming parser in main.ts.
"""
import json
import sqlite3
import os
import sys
import re

# Enable debug logging to a file the overlay can access
LOG_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'get_session_debug.log')

def log(msg):
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(f"{msg}\n")
    except:
        pass

log(f"=== get_session.py invoked ===")
log(f"Args: {sys.argv}")

def strip_tool_calls_from_assistant_text(content: str) -> str:
    """Strip tool-call JSON blobs that were incorrectly stored in assistant content.
    
    Older Hermes versions serialized tool calls as JSON strings inside the assistant's
    text content (e.g., 'terminal · {"command": "..."}"). This function detects and
    removes these patterns, leaving only the actual assistant response text.
    
    Returns the cleaned text, or the original if no tool-call patterns found.
    """
    if not isinstance(content, str):
        return content
    
    # Pattern: toolname · {"..."} where the JSON may span multiple lines
    lines = content.split('\n')
    cleaned_lines = []
    skip_until_close = False
    brace_depth = 0
    
    for line in lines:
        # Detect start of tool-call JSON: "toolname · {"
        match = re.match(r'^(\w+)\s+·\s+\{', line)
        if match:
            # Count braces to find where the JSON ends
            brace_depth = line.count('{') - line.count('}')
            if brace_depth <= 0:
                # Single-line JSON, skip this line entirely
                continue
            else:
                # Multi-line JSON, start skipping
                skip_until_close = True
                continue
        
        if skip_until_close:
            brace_depth += line.count('{') - line.count('}')
            if brace_depth <= 0:
                # JSON block ended
                skip_until_close = False
            # Skip this line (it's part of the JSON blob)
            continue
        
        # Not a tool-call line, keep it
        cleaned_lines.append(line)
    
    result = '\n'.join(cleaned_lines)
    
    # If we stripped everything or the result is mostly whitespace, 
    # return a placeholder instead of empty
    if not result.strip() and content.strip():
        return "[Tool execution completed]"
    
    return result


def extract_segments(content):
    """
    Apply the exact same formatting as the live streaming parser in main.ts,
    but return an array of structured segments (text, diff, tool_activity)
    so that resumed sessions render identical to live sessions.
    """
    if not content:
        return []
    
    # 1. Remove ANSI escape sequences
    clean_content = re.sub(r'[\u001b\u009b][\[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]', '', content)
    
    lines = clean_content.split('\n')
    segments = []
    
    in_box = False
    in_diff = False
    diff_buffer = []
    is_thinking_box = False
    
    tool_buffer = []
    tool_name = None
    text_buffer = []

    def flush_text():
        if text_buffer:
            text = '\n'.join(text_buffer).strip()
            if text:
                segments.append({"type": "text", "content": text})
            text_buffer.clear()
            
    def flush_tool():
        if tool_buffer:
            text = '\n'.join(tool_buffer).strip()
            if text:
                seg = {"type": "tool_activity", "content": text}
                if tool_name:
                    seg["toolName"] = tool_name
                segments.append(seg)
            tool_buffer.clear()

    for line in lines:
        trimmed = line.strip()
        
        # Skip metadata lines
        if (trimmed.startswith('Query:') or
            trimmed.startswith('Initializing agent') or
            re.match(r'^─+$', trimmed) or
            trimmed.startswith('Resume this session with:') or
            trimmed.startswith('hermes --resume') or
            trimmed.startswith('Session:') or
            trimmed.startswith('Duration:') or
            trimmed.startswith('Messages:') or
            trimmed.startswith('Exit code:') or
            trimmed.startswith('↻') or
            re.match(r'Resumed session', trimmed)):
            continue
            
        if in_diff:
            if trimmed.startswith('\u256d\u2500') or (trimmed == '' and len(diff_buffer) > 0):
                flush_text()
                segments.append({"type": "diff", "content": '\n'.join(diff_buffer).strip()})
                in_diff = False
                diff_buffer = []
            else:
                diff_buffer.append(line)
            continue
            
        if trimmed.startswith('\u256d\u2500'):
            in_box = True
            is_thinking_box = 'thinking' in trimmed.lower() or 'reasoning' in trimmed.lower()
            continue
            
        if re.match(r'^\u2500+\s+\u2695 Hermes', trimmed):
            in_box = True
            is_thinking_box = False
            continue
            
        if in_box and trimmed.startswith('\u2570\u2500'):
            in_box = False
            continue
            
        if in_box:
            flush_tool()
            content_line = re.sub(r'^    ', '', line)
            # Live parser creates 'thinking' segments for thinking boxes. We will just parse them as thinking here too.
            if is_thinking_box:
                # We can append it to text_buffer for now or handle it specially.
                # Actually, reasoning is pulled from DB columns directly.
                # Let's just treat it as text buffer to avoid dropping it if DB reasoning is missing.
                # But to avoid double thinking blocks, if the DB reasoning exists, we should ignore this.
                pass 
            else:
                text_buffer.append(content_line)
            continue
            
        # Tool activity
        if trimmed.startswith('\u250a') or re.match(r'^[\u2502\u250a]\s', trimmed):
            tool_match = re.match(r'[\u2502\u250a]\s*(?:\U0001f4bb|\u270d\ufe0f|\U0001f50d|\U0001f4c1|\U0001f310|\u26a1|\U0001f527|\U0001f4dd|\U0001f6e0\ufe0f|\u2699\ufe0f|\U0001f512)\s*(?:preparing\s+)?(.+?)\u2026?$', trimmed)
            if tool_match:
                flush_text()
                flush_tool()
                tool_name = tool_match.group(1).strip()
                content_text = re.sub(r'^[\u2502\u250a]\s*', '', trimmed)
                tool_buffer.append(content_text)
            elif 'review diff' in trimmed:
                flush_text()
                flush_tool()
                in_diff = True
                diff_buffer = []
            else:
                content_text = re.sub(r'^[\u2502\u250a]\s*', '', trimmed)
                tool_buffer.append(content_text)
            continue
            
        if trimmed:
            flush_tool()
            text_buffer.append(re.sub(r'^    ', '', line))
        else:
            flush_tool()
            text_buffer.append('')
            
    if in_diff and diff_buffer:
        flush_text()
        segments.append({"type": "diff", "content": '\n'.join(diff_buffer).strip()})
    
    flush_tool()
    flush_text()
    
    return segments


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No session ID provided"}))
        return
        
    session_id = sys.argv[1]
    
    try:
        # Resolve hermes state.db path
        local_app_data = os.environ.get("LOCALAPPDATA", os.path.join(os.path.expanduser("~"), "AppData", "Local"))
        db_path = os.path.join(local_app_data, "hermes", "state.db")
        
        if not os.path.exists(db_path):
            print(json.dumps([]))
            return

        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Get messages for session
        cursor.execute('''
            SELECT id, role, content, timestamp, tool_call_id, tool_calls, tool_name, reasoning, reasoning_content 
            FROM messages 
            WHERE session_id = ? 
            ORDER BY timestamp ASC
        ''', (session_id,))
        
        messages = []
        tool_calls_by_id = {}
        
        for row in cursor.fetchall():
            role = row['role']
            content = row['content'] or ''
            
            if role == 'tool':
                tc_id = row['tool_call_id']
                output_str = content
                
                # Decode \x00json: sentinel and raw JSON
                if isinstance(content, str):
                    if content.startswith('\x00json:'):
                        try:
                            parsed = json.loads(content[6:])
                            output_str = json.dumps(parsed, indent=2) if isinstance(parsed, dict) else str(parsed)
                        except:
                            pass
                    elif content.startswith('{') or content.startswith('['):
                        try:
                            parsed = json.loads(content)
                            output_str = json.dumps(parsed, indent=2) if isinstance(parsed, dict) else str(parsed)
                        except:
                            pass
                    elif '\\"' in content or '\\n' in content:
                        try:
                            unescaped = content.encode().decode('unicode_escape')
                            if unescaped.startswith('{') or unescaped.startswith('['):
                                parsed = json.loads(unescaped)
                                output_str = json.dumps(parsed, indent=2) if isinstance(parsed, dict) else str(parsed)
                            else:
                                output_str = unescaped
                        except:
                            pass
                
                if tc_id and tc_id in tool_calls_by_id:
                    tool_calls_by_id[tc_id]["output"] = output_str
                    tool_calls_by_id[tc_id]["status"] = "success"
                
                # Do not emit a separate message bubble for the tool result
                continue

            # Basic parsing of tool calls if any
            tool_calls = []
            if row['tool_calls']:
                try:
                    tool_calls_data = json.loads(row['tool_calls'])
                    for tc in tool_calls_data:
                        tc_id = tc.get("id", "")
                        
                        # Extract command/args properly - don't JSON stringify
                        fn_args = tc.get("function", {}).get("arguments", "{}")
                        try:
                            args_dict = json.loads(fn_args) if isinstance(fn_args, str) else fn_args
                            # For terminal: extract the command string
                            if tc.get("function", {}).get("name") == "terminal":
                                command_str = args_dict.get("command", json.dumps(args_dict))
                            # For write_file: show path or content preview
                            elif tc.get("function", {}).get("name") == "write_file":
                                if args_dict.get("path"):
                                    command_str = f"📁 {args_dict['path']}"
                                elif args_dict.get("content"):
                                    first_line = args_dict["content"].split('\n')[0][:50]
                                    command_str = f"📝 {first_line}..." if '\n' in args_dict["content"] else f"📝 {first_line}"
                                else:
                                    command_str = json.dumps(args_dict)
                            else:
                                # For other tools, show a summary
                                first_key = next(iter(args_dict.keys()), None)
                                if first_key:
                                    val = args_dict[first_key]
                                    command_str = f"{first_key}: {str(val)[:50]}"
                                else:
                                    command_str = json.dumps(args_dict)
                        except:
                            command_str = fn_args

                        tc_obj = {
                            "id": tc_id,
                            "name": tc.get("function", {}).get("name", ""),
                            "command": command_str,
                            "status": "success"  # Assume success for historical tool calls
                        }
                        tool_calls.append(tc_obj)
                        if tc_id:
                            tool_calls_by_id[tc_id] = tc_obj
                except:
                    pass
            
            # Strip corrupted tool-call JSON blobs (from older Hermes versions)
            if role == 'assistant':
                old_content = content
                content = strip_tool_calls_from_assistant_text(content)
                if old_content != content:
                    pass

            # Apply streaming parser formatting to extract segments
            extracted_segments = extract_segments(content)
            
            reasoning = row['reasoning'] or row['reasoning_content']
            
            # Create segments for structured rendering
            segments = []
            
            # Add reasoning segment if present
            if reasoning and reasoning.strip():
                segments.append({
                    "type": "thinking",
                    "content": reasoning.strip()
                })
            
            # Add extracted segments
            segments.extend(extracted_segments)
            
            # The top-level content string should be the concatenation of all text segments,
            # so it matches what live streaming does for fallback.
            text_contents = [s['content'] for s in extracted_segments if s['type'] == 'text']
            final_content = '\n\n'.join(text_contents)
            
            messages.append({
                "id": f"{row['id']}_{row['timestamp']}" if row['timestamp'] else str(row['id']),
                "role": role,
                "content": final_content,
                "timestamp": int(row['timestamp'] * 1000) if row['timestamp'] else 0,
                "toolCalls": tool_calls,
                "segments": segments,
                "attachments": []
            })
        
        conn.close()
        
        output = json.dumps(messages if messages else [])
        print(output)
        
    except Exception as e:
        print(json.dumps([]))
        print(f"Error in get_session.py: {e}", file=sys.stderr)

if __name__ == "__main__":
    main()