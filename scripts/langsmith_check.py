"""LangSmith izlərinin yoxlanması — YALNIZ OXUYUR, model çağırmır.

    python scripts/langsmith_check.py [son N iz, susmaya görə 10]

Layihənin (`LANGSMITH_PROJECT`) son kök izlərini oxuyur və yoxlayır:
  • yoxlama izi: ad "Komitə: <plan> v<N>", teq "biznes-plan-komite", metadata check_id/plan_id/version;
  • iz daxilində agent teqləri (maliyye, uygunluq, rey, elave) və alət çağırışları;
  • AI köməkçi izi: ad "AI köməkçi", teq "ai-komekci", handoff alətləri (transfer_to_*).
Açar `.env`-dən oxunur və heç yerə çap edilmir.
"""
from __future__ import annotations

import collections
import warnings
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

if not os.getenv("LANGSMITH_API_KEY", "").strip():
    sys.exit("LANGSMITH_API_KEY yoxdur — yoxlama aparılmadı.")

from langsmith import Client  # noqa: E402

warnings.filterwarnings("ignore", category=DeprecationWarning)
PROJECT = os.getenv("LANGSMITH_PROJECT", "biznes-plan-komite")
AGENT_TAGS = {"maliyye", "uygunluq", "rey", "elave_telebler", "check_groups", "locate"}


def main(limit: int) -> int:
    client = Client()
    roots = list(client.list_runs(project_name=PROJECT, is_root=True, limit=limit))
    print(f"Layihə: {PROJECT} · son {len(roots)} kök iz\n")
    problems = 0
    for run in roots:
        name = run.name or ""
        kind = ("yoxlama" if name.startswith("Komitə:") else "çıxarış" if name.startswith("Əlavə tələblər:")
                else "köməkçi" if name == "AI köməkçi" else "digər")
        meta = (run.extra or {}).get("metadata", {}) or {}
        tags = set(run.tags or [])
        children = list(client.list_runs(project_name=PROJECT, trace_id=run.trace_id))   # bütün səhifələr
        types = collections.Counter(c.run_type for c in children)
        child_tags = set().union(*[set(c.tags or []) for c in children]) if children else set()
        tools = collections.Counter(c.name for c in children if c.run_type == "tool")
        errors = [c.name for c in children if c.error]
        notes = []
        if kind == "yoxlama":
            if "biznes-plan-komite" not in tags:
                notes.append("teq 'biznes-plan-komite' yoxdur")
            missing = [k for k in ("check_id", "plan_id", "version") if k not in meta]
            if missing:
                notes.append("metadata çatmır: " + ", ".join(missing))
            if not (child_tags & AGENT_TAGS):
                notes.append("agent teqləri tapılmadı")
        if kind == "çıxarış" and not {"check_id", "plan_id"} <= set(meta):
            notes.append("çıxarış izi yoxlamaya bağlı deyil (check_id/plan_id yoxdur)")
        if kind == "köməkçi":
            if "ai-komekci" not in tags:
                notes.append("teq 'ai-komekci' yoxdur")
            handoffs = [n for n in tools if n.startswith("transfer_to_")]
            print(f"   handoff: {handoffs or 'yoxdur (bələdçi özü cavab verib)'}")
        if kind == "digər":
            notes.append("tanınmayan kök iz: ad/teq/metadata yoxlamaya bağlı deyil")
        problems += bool(notes)
        when = run.start_time.strftime("%d.%m.%Y %H:%M") if run.start_time else "?"
        print(f"[{kind}] {run.name} · {when} · status: {run.status}"
              f"{' · XƏTA' if run.error else ''}")
        print(f"   alt izlər: {dict(types)} · agent teqləri: {sorted(child_tags & AGENT_TAGS) or '—'}")
        if tools:
            print(f"   alətlər: {dict(tools.most_common(8))}")
        if errors:
            print(f"   xətalı alt izlər: {errors[:5]}")
        print("   yoxlama: " + ("uyğun" if not notes else "; ".join(notes)) + "\n")
    print(f"Nəticə: {len(roots) - problems}/{len(roots)} iz gözlənilən quruluşdadır.")
    return 0


if __name__ == "__main__":
    sys.exit(main(int(sys.argv[1]) if len(sys.argv) > 1 else 10))
