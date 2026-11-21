#!/usr/bin/env python3
"""Generate the README's SVG exports and editable Excalidraw scene files."""

from __future__ import annotations

import json
import random
from html import escape
from pathlib import Path


OUT = Path(__file__).parent
INK = "#2f2f2f"
MUTED = "#66615b"
PAPER = "#fffdf8"
CREAM = "#fff7ed"
ORANGE = "#f59e0b"
ORANGE_PALE = "#ffedd5"
GREEN = "#4d9b69"
GREEN_PALE = "#e7f5eb"
PURPLE = "#7c68a8"
PURPLE_PALE = "#f0ebf8"
WHITE = "#ffffff"


class Scene:
    def __init__(self, name: str, title: str, width: int, height: int):
        self.name = name
        self.title = title
        self.width = width
        self.height = height
        self.svg: list[str] = []
        self.elements: list[dict] = []
        self.counter = 0
        self.random = random.Random(name)

    def _base(self, kind: str, x: float, y: float, width: float, height: float, **extra) -> dict:
        self.counter += 1
        return {
            "id": f"{self.name}-{self.counter}",
            "type": kind,
            "x": x,
            "y": y,
            "width": width,
            "height": height,
            "angle": 0,
            "strokeColor": extra.pop("strokeColor", INK),
            "backgroundColor": extra.pop("backgroundColor", "transparent"),
            "fillStyle": "solid",
            "strokeWidth": extra.pop("strokeWidth", 2),
            "strokeStyle": extra.pop("strokeStyle", "solid"),
            "roughness": 1,
            "opacity": 100,
            "groupIds": [],
            "frameId": None,
            "roundness": extra.pop("roundness", {"type": 3}),
            "seed": self.random.randint(1, 2_000_000_000),
            "version": 1,
            "versionNonce": self.random.randint(1, 2_000_000_000),
            "isDeleted": False,
            "boundElements": [],
            "updated": 1,
            "link": None,
            "locked": False,
            **extra,
        }

    def rect(self, x: int, y: int, w: int, h: int, fill: str = WHITE, stroke: str = INK, radius: int = 20):
        self.svg.append(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" '
            f'fill="{fill}" stroke="{stroke}" stroke-width="3" filter="url(#wobble)"/>'
        )
        self.svg.append(
            f'<rect x="{x + 2}" y="{y - 1}" width="{w - 2}" height="{h + 1}" rx="{radius}" '
            f'fill="none" stroke="{stroke}" stroke-width="1.2" opacity=".28"/>'
        )
        self.elements.append(
            self._base("rectangle", x, y, w, h, strokeColor=stroke, backgroundColor=fill, roundness={"type": 3})
        )

    def line(self, x1: int, y1: int, x2: int, y2: int, color: str = INK, dashed: bool = False):
        dash = ' stroke-dasharray="10 9"' if dashed else ""
        self.svg.append(
            f'<path d="M {x1} {y1} L {x2} {y2}" fill="none" stroke="{color}" '
            f'stroke-width="3" stroke-linecap="round"{dash}/>'
        )
        self.elements.append(
            self._base(
                "line",
                x1,
                y1,
                x2 - x1,
                y2 - y1,
                strokeColor=color,
                strokeStyle="dashed" if dashed else "solid",
                roundness=None,
                points=[[0, 0], [x2 - x1, y2 - y1]],
                lastCommittedPoint=None,
                startBinding=None,
                endBinding=None,
                startArrowhead=None,
                endArrowhead=None,
            )
        )

    def arrow(self, x1: int, y1: int, x2: int, y2: int, color: str = INK, dashed: bool = False):
        dash = ' stroke-dasharray="10 9"' if dashed else ""
        self.svg.append(
            f'<path d="M {x1} {y1} L {x2} {y2}" fill="none" stroke="{color}" '
            f'stroke-width="3" stroke-linecap="round" marker-end="url(#arrow)"{dash}/>'
        )
        self.elements.append(
            self._base(
                "arrow",
                x1,
                y1,
                x2 - x1,
                y2 - y1,
                strokeColor=color,
                strokeStyle="dashed" if dashed else "solid",
                roundness={"type": 2},
                points=[[0, 0], [x2 - x1, y2 - y1]],
                lastCommittedPoint=None,
                startBinding=None,
                endBinding=None,
                startArrowhead=None,
                endArrowhead="arrow",
                elbowed=False,
            )
        )

    def text(
        self,
        x: int,
        y: int,
        text: str,
        size: int = 24,
        color: str = INK,
        weight: int = 500,
        anchor: str = "start",
    ):
        lines = text.split("\n")
        line_height = int(size * 1.25)
        for index, line in enumerate(lines):
            yy = y + index * line_height
            self.svg.append(
                f'<text x="{x}" y="{yy}" fill="{color}" font-size="{size}" font-weight="{weight}" '
                f'text-anchor="{anchor}" font-family="ui-rounded, &quot;SF Pro Rounded&quot;, '
                f'&quot;Segoe UI&quot;, sans-serif">{escape(line)}</text>'
            )
        width = max((len(line) for line in lines), default=1) * size * 0.58
        align = {"start": "left", "middle": "center", "end": "right"}[anchor]
        self.elements.append(
            self._base(
                "text",
                x if anchor == "start" else x - width / 2 if anchor == "middle" else x - width,
                y - size,
                width,
                line_height * len(lines),
                strokeColor=color,
                backgroundColor="transparent",
                roundness=None,
                text=text,
                fontSize=size,
                fontFamily=1,
                textAlign=align,
                verticalAlign="top",
                containerId=None,
                originalText=text,
                autoResize=True,
                lineHeight=1.25,
            )
        )

    def pill(self, x: int, y: int, w: int, text: str, fill: str, stroke: str):
        self.rect(x, y, w, 44, fill, stroke, 22)
        self.text(x + w // 2, y + 29, text, 18, stroke, 650, "middle")

    def save(self):
        definitions = f"""
  <defs>
    <filter id="wobble" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency=".009" numOctaves="1" seed="8" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.3"/>
    </filter>
    <marker id="arrow" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
      <path d="M 1 1 L 11 6 L 1 11" fill="none" stroke="{INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </marker>
  </defs>"""
        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc" '
            f'viewBox="0 0 {self.width} {self.height}" width="{self.width}" height="{self.height}">\n'
            f'  <title id="title">{escape(self.title)}</title>\n'
            f'  <desc id="desc">Excalidraw-style diagram for the grokbot-bridge documentation.</desc>\n'
            f'  <rect width="100%" height="100%" fill="{PAPER}"/>{definitions}\n  '
            + "\n  ".join(self.svg)
            + "\n</svg>\n"
        )
        (OUT / f"{self.name}.svg").write_text(svg, encoding="utf-8")
        scene = {
            "type": "excalidraw",
            "version": 2,
            "source": "https://github.com/hetaoBackend/grokbot-bridge",
            "elements": self.elements,
            "appState": {
                "gridSize": None,
                "viewBackgroundColor": PAPER,
                "currentItemFontFamily": 1,
            },
            "files": {},
        }
        (OUT / f"{self.name}.excalidraw").write_text(
            json.dumps(scene, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )


def overview():
    s = Scene("overview", "What grokbot-bridge does", 1200, 620)
    s.text(60, 65, "Use your Grok Bot from code — without switching windows.", 34, INK, 750)
    s.text(60, 105, "Example: MiniMax Code sends a research task; the matching Bot reply returns to the same tool call.", 20, MUTED)

    s.rect(70, 170, 280, 210, PURPLE_PALE, PURPLE)
    s.text(210, 220, "Coding agent", 28, PURPLE, 750, "middle")
    s.text(210, 265, "Claude Code · Codex", 20, INK, 500, "middle")
    s.text(210, 296, "MiniMax Code · Cursor", 20, INK, 500, "middle")
    s.pill(125, 322, 170, "MCP client", WHITE, PURPLE)

    s.rect(460, 150, 280, 250, CREAM, ORANGE)
    s.text(600, 205, "grokbot-bridge", 30, INK, 750, "middle")
    s.text(600, 252, "list + read", 22, GREEN, 700, "middle")
    s.text(600, 286, "ask + wait", 22, ORANGE, 700, "middle")
    s.text(600, 337, "No clicks. No focus.", 20, MUTED, 550, "middle")
    s.text(600, 366, "No clipboard.", 20, MUTED, 550, "middle")

    s.rect(850, 170, 280, 210, GREEN_PALE, GREEN)
    s.text(990, 220, "Your Grok Bot", 28, GREEN, 750, "middle")
    s.text(990, 265, "Routine runs in cloud", 20, INK, 500, "middle")
    s.text(990, 296, "Reply syncs to app cache", 20, INK, 500, "middle")
    s.pill(905, 322, 170, "existing Bot", WHITE, GREEN)

    s.arrow(350, 275, 450, 275, PURPLE)
    s.text(400, 250, "tools", 17, MUTED, 600, "middle")
    s.arrow(740, 275, 840, 275, ORANGE)
    s.text(790, 250, "task / reply", 17, MUTED, 600, "middle")

    s.rect(70, 470, 1060, 95, WHITE, INK, 18)
    s.text(105, 512, "Good fit", 21, GREEN, 750)
    s.text(215, 512, "macOS + signed-in Grok Bot app + Node 20+; routines are needed only for sending.", 20, INK)
    s.text(105, 545, "Not this", 21, ORANGE, 750)
    s.text(215, 545, "a public chat API, UI automation, or real-time two-way sync.", 20, INK)
    s.save()


def architecture():
    s = Scene("architecture", "grokbot-bridge architecture and trust boundaries", 1200, 720)
    s.text(60, 62, "One outbound webhook. One read-only local cache.", 34, INK, 750)
    s.text(60, 102, "The bridge joins two mechanisms Grok Bot already provides; it does not drive the desktop UI.", 20, MUTED)

    s.rect(45, 140, 730, 500, WHITE, PURPLE, 26)
    s.text(80, 185, "YOUR MAC", 18, PURPLE, 750)
    s.rect(95, 230, 210, 125, PURPLE_PALE, PURPLE)
    s.text(200, 278, "MCP client", 25, PURPLE, 750, "middle")
    s.text(200, 316, "calls 4 tools", 19, INK, 500, "middle")
    s.rect(395, 210, 310, 165, CREAM, ORANGE)
    s.text(550, 260, "grokbot-bridge", 27, INK, 750, "middle")
    s.text(550, 302, "stdio MCP server", 19, MUTED, 500, "middle")
    s.text(550, 335, "polls every 2s by default", 18, MUTED, 500, "middle")
    s.arrow(305, 292, 385, 292, PURPLE)

    s.rect(395, 455, 310, 125, GREEN_PALE, GREEN)
    s.text(550, 500, "Desktop app cache", 24, GREEN, 750, "middle")
    s.text(550, 537, "account slot · roster · transcripts", 16, INK, 500, "middle")
    s.arrow(550, 445, 550, 385, GREEN)
    s.text(570, 423, "read-only", 17, GREEN, 650)

    s.rect(835, 140, 320, 500, WHITE, GREEN, 26)
    s.text(870, 185, "GROK BOT CLOUD", 18, GREEN, 750)
    s.rect(885, 230, 220, 125, ORANGE_PALE, ORANGE)
    s.text(995, 275, "Routine webhook", 24, ORANGE, 750, "middle")
    s.text(995, 313, "runs the Bot", 19, INK, 500, "middle")
    s.rect(885, 455, 220, 125, GREEN_PALE, GREEN)
    s.text(995, 500, "Bot reply", 24, GREEN, 750, "middle")
    s.text(995, 537, "starts with reply tag", 18, INK, 500, "middle")
    s.arrow(705, 270, 875, 270, ORANGE)
    s.text(790, 246, "HTTPS POST", 17, ORANGE, 700, "middle")
    s.arrow(995, 365, 995, 445, GREEN)
    s.text(1015, 410, "run", 17, GREEN, 650)
    s.arrow(875, 525, 715, 525, GREEN, True)
    s.text(795, 500, "desktop app sync", 17, GREEN, 650, "middle")

    s.pill(85, 665, 280, "webhook key = authentication", ORANGE_PALE, ORANGE)
    s.pill(390, 665, 270, "reply_tag = correlation only", PURPLE_PALE, PURPLE)
    s.pill(685, 665, 430, "no Cursor/xAI private API is called", GREEN_PALE, GREEN)
    s.save()


def flow():
    s = Scene("message-flow", "A real ask and reply flow", 1200, 780)
    s.text(60, 62, "What happens when an MCP client calls ask", 34, INK, 750)
    s.text(60, 102, "The return path is the desktop cache, so the app must be running and syncing.", 20, MUTED)

    xs = [150, 465, 765, 1050]
    labels = [
        ("MCP client", PURPLE, PURPLE_PALE),
        ("bridge", ORANGE, CREAM),
        ("Routine + Bot", GREEN, GREEN_PALE),
        ("local cache", INK, WHITE),
    ]
    for x, (label, color, fill) in zip(xs, labels):
        s.pill(x - 105, 140, 210, label, fill, color)
        s.line(x, 195, x, 680, color, True)

    s.arrow(165, 235, 445, 235, PURPLE)
    s.text(305, 216, "1 · ask(bot, message)", 18, PURPLE, 700, "middle")

    s.arrow(485, 315, 745, 315, ORANGE)
    s.text(615, 275, "2 · HTTPS POST", 18, ORANGE, 750, "middle")
    s.text(615, 299, "request_id · reply_tag · message", 16, MUTED, 500, "middle")

    s.arrow(785, 390, 1030, 390, GREEN)
    s.text(907, 366, "3 · reply syncs", 18, GREEN, 750, "middle")

    s.arrow(1030, 470, 485, 470, GREEN, True)
    s.text(757, 446, "4 · poll transcripts; find matching tag", 18, GREEN, 700, "middle")

    s.arrow(445, 555, 165, 555, ORANGE)
    s.text(305, 530, "5 · done / partial / pending / sent", 18, ORANGE, 700, "middle")

    s.rect(75, 620, 1050, 105, WHITE, INK, 18)
    s.text(105, 660, "Important", 20, ORANGE, 750)
    s.text(225, 660, "The reply tag matches a response; it does not authenticate one.", 19, INK, 600)
    s.text(105, 696, "Safety", 20, PURPLE, 750)
    s.text(225, 696, "Routine + agent instructions request confirmation for side effects; runtime does not enforce it.", 18, INK, 600)
    s.save()


if __name__ == "__main__":
    overview()
    architecture()
    flow()
    print("Generated 3 SVG exports and 3 editable .excalidraw files.")
