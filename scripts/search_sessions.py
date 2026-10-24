"""Hermes Overlay — Search sessions bridge.

Invoked by the Electron main process to search sessions in the Hermes backend
SQLite store (state.db) using FTS5 full-text search.

Outputs a JSON array of sessions matching the query.
"""
import json
import sqlite3
import os
import sys

def main():
    if len(sys.argv) < 2:
        print(json.dumps([]))
        return

    query = sys.argv[1]

    try:
        local_app_data = os.environ.get("LOCALAPPDATA", os.path.join(os.path.expanduser("~"), "AppData", "Local"))
        db_path = os.path.join(local_app_data, "hermes", "state.db")

        if not os.path.exists(db_path):
            print(json.dumps([]))
            return

        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # Try FTS5 search first (sessions_search virtual table)
        try:
            # Escape single quotes for SQL safety
            safe_query = query.replace("'", "''")

            # Search in the sessions FTS table for titles
            cursor.execute('''
                SELECT s.id, s.title, s.started_at, s.message_count,
                       snippet(sessions_search, 0, '<mark>', '</mark>', '...', 20) as snippet
                FROM sessions s
                JOIN sessions_search ON s.rowid = sessions_search.rowid
                WHERE sessions_search MATCH ?
                ORDER BY s.started_at DESC
                LIMIT 30
            ''', (safe_query,))

            sessions = []
            for row in cursor.fetchall():
                title = row['title'] or "New Session"
                if not title.strip():
                    try:
                        import datetime
                        dt = datetime.datetime.fromtimestamp(row['started_at']) if row['started_at'] else None
                        title = dt.strftime('Session %Y-%m-%d %H:%M') if dt else "New Session"
                    except:
                        title = "New Session"

                sessions.append({
                    "id": row['id'],
                    "title": title.strip(),
                    "started_at": (row['started_at'] or 0) * 1000,
                    "message_count": row['message_count'] or 0,
                    "snippet": row['snippet'] or ""
                })

            conn.close()
            print(json.dumps(sessions))
            return

        except sqlite3.OperationalError:
            # FTS table might not exist — fall back to LIKE search
            pass

        # Fallback: LIKE search on session titles and message content
        safe_like = '%' + query.replace('%', '\\%').replace('_', '\\_') + '%'

        # Search session titles
        cursor.execute('''
            SELECT id, title, started_at, message_count
            FROM sessions
            WHERE archived = 0 AND title LIKE ? ESCAPE '\\'
            ORDER BY started_at DESC
            LIMIT 30
        ''', (safe_like,))

        sessions = []
        seen_ids = set()
        for row in cursor.fetchall():
            if row['id'] in seen_ids:
                continue
            seen_ids.add(row['id'])
            title = row['title'] or "New Session"
            if not title.strip():
                try:
                    import datetime
                    dt = datetime.datetime.fromtimestamp(row['started_at']) if row['started_at'] else None
                    title = dt.strftime('Session %Y-%m-%d %H:%M') if dt else "New Session"
                except:
                    title = "New Session"

            sessions.append({
                "id": row['id'],
                "title": title.strip(),
                "started_at": (row['started_at'] or 0) * 1000,
                "message_count": row['message_count'] or 0,
                "snippet": ""
            })

        # Also search message content for sessions not already found
        cursor.execute('''
            SELECT DISTINCT s.id, s.title, s.started_at, s.message_count,
                   substr(m.content, 1, 120) as snippet
            FROM sessions s
            JOIN messages m ON s.id = m.session_id
            WHERE s.archived = 0 AND m.content LIKE ? ESCAPE '\\'
            ORDER BY s.started_at DESC
            LIMIT 30
        ''', (safe_like,))

        for row in cursor.fetchall():
            if row['id'] in seen_ids:
                continue
            seen_ids.add(row['id'])
            title = row['title'] or "New Session"
            if not title.strip():
                try:
                    import datetime
                    dt = datetime.datetime.fromtimestamp(row['started_at']) if row['started_at'] else None
                    title = dt.strftime('Session %Y-%m-%d %H:%M') if dt else "New Session"
                except:
                    title = "New Session"

            sessions.append({
                "id": row['id'],
                "title": title.strip(),
                "started_at": (row['started_at'] or 0) * 1000,
                "message_count": row['message_count'] or 0,
                "snippet": row['snippet'] or ""
            })

        conn.close()
        print(json.dumps(sessions))

    except Exception as e:
        print(json.dumps([]))
        print(f"Error: {e}", file=sys.stderr)

if __name__ == "__main__":
    main()
