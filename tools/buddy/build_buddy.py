#!/usr/bin/env python3
"""Build and render the Work-home felt buddy with Blender.

Run this file through Blender, not the system Python. Everything visible in the
render is generated here so the source art can be reproduced without a .blend
file. See tools/buddy/README.md for the exact commands.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import tempfile
from pathlib import Path

import bpy
from mathutils import Vector


FPS = 12
CLIPS = {
    "idle": {"frames": 48, "loop": True},
    "blink": {"frames": 4, "loop": False},
    "hello": {"frames": 10, "loop": False},
    "listening": {"frames": 24, "loop": True},
    "nod": {"frames": 4, "loop": False},
    "thinking": {"frames": 24, "loop": True},
    "talking": {"frames": 12, "loop": True},
    "happy": {"frames": 12, "loop": False},
}


def parse_args() -> argparse.Namespace:
    raw = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--render", action="store_true", help="Render clip frames and still.webp")
    parser.add_argument("--preview", action="store_true", help="Render one preview frame")
    parser.add_argument("--clip", choices=[*CLIPS, "all"], default="all")
    parser.add_argument(
        "--frames-dir",
        type=Path,
        default=Path(tempfile.gettempdir()) / "personal-website-buddy-frames",
    )
    parser.add_argument("--output-dir", type=Path, default=None)
    parser.add_argument("--save-blend", type=Path, default=None)
    parser.add_argument("--samples", type=int, default=32)
    parser.add_argument("--engine", choices=("cycles", "eevee"), default="cycles")
    parser.add_argument("--device", choices=("auto", "cpu", "gpu"), default="auto")
    return parser.parse_args(raw)


def hex_color(value: str, alpha: float = 1.0) -> tuple[float, float, float, float]:
    value = value.lstrip("#")
    rgb = [int(value[i : i + 2], 16) / 255.0 for i in (0, 2, 4)]
    # Blender color inputs are scene-linear.
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    return (*linear, alpha)


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.armatures,
        bpy.data.actions,
    ):
        for block in list(collection):
            if block.users == 0:
                collection.remove(block)


def set_socket(node, names: tuple[str, ...], value) -> None:
    for name in names:
        socket = node.inputs.get(name)
        if socket is not None:
            socket.default_value = value
            return


def felt_material(name: str, color: str, roughness: float = 0.85, bump: float = 0.13):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = hex_color(color)
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    set_socket(bsdf, ("Base Color",), hex_color(color))
    set_socket(bsdf, ("Roughness",), roughness)
    set_socket(bsdf, ("Sheen Weight", "Sheen"), 1.0)
    set_socket(bsdf, ("Sheen Roughness",), 0.7)

    noise = nodes.new("ShaderNodeTexNoise")
    noise.name = "Felt fibers"
    noise.inputs["Scale"].default_value = 105.0
    noise.inputs["Detail"].default_value = 3.0
    noise.inputs["Roughness"].default_value = 0.72
    bump_node = nodes.new("ShaderNodeBump")
    bump_node.name = "Fine felt nap"
    bump_node.inputs["Strength"].default_value = bump
    bump_node.inputs["Distance"].default_value = 0.035
    links.new(noise.outputs["Fac"], bump_node.inputs["Height"])
    links.new(bump_node.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def simple_material(name: str, color: str, roughness: float = 0.7, metallic: float = 0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = hex_color(color)
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    set_socket(bsdf, ("Base Color",), hex_color(color))
    set_socket(bsdf, ("Roughness",), roughness)
    set_socket(bsdf, ("Metallic",), metallic)
    return mat


def glass_material(name: str):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = hex_color("#E7EEF7", 0.18)
    mat.surface_render_method = "DITHERED"
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    set_socket(bsdf, ("Base Color",), hex_color("#FFFFFF"))
    set_socket(bsdf, ("Roughness",), 0.045)
    set_socket(bsdf, ("Transmission Weight", "Transmission"), 1.0)
    set_socket(bsdf, ("Coat Weight", "Coat"), 0.45)
    set_socket(bsdf, ("Alpha",), 0.14)
    set_socket(bsdf, ("IOR",), 1.45)
    return mat


def add_uv_sphere(name, location, scale, material, segments=48, rings=32):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    return obj


def add_beveled_cube(name, location, scale, material, bevel=0.18):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    mod = obj.modifiers.new("Soft rounded edges", "BEVEL")
    mod.width = bevel
    mod.segments = 5
    obj.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    return obj


def add_hair_panel(name, outline, y, depth, material):
    count = len(outline)
    vertices = [(x, y - depth / 2, z) for x, z in outline]
    vertices.extend((x, y + depth / 2, z) for x, z in outline)
    faces = [tuple(reversed(range(count))), tuple(range(count, count * 2))]
    for index in range(count):
        nxt = (index + 1) % count
        faces.append((index, nxt, count + nxt, count + index))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    bevel = obj.modifiers.new("Soft felt edge", "BEVEL")
    bevel.width = 0.09
    bevel.segments = 4
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.shade_smooth()
    obj.select_set(False)
    return obj


def add_curve(name, points, bevel_depth, material, cyclic=False, resolution=3):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = resolution
    curve.bevel_depth = bevel_depth
    curve.bevel_resolution = 4
    curve.resolution_u = 12
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, coords in zip(spline.bezier_points, points):
        point.co = coords
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    return obj


def rounded_rect_points(cx, y, cz, width, height, radius, corner_steps=5):
    points = []
    corners = (
        (cx + width / 2 - radius, cz + height / 2 - radius, 0, 90),
        (cx - width / 2 + radius, cz + height / 2 - radius, 90, 180),
        (cx - width / 2 + radius, cz - height / 2 + radius, 180, 270),
        (cx + width / 2 - radius, cz - height / 2 + radius, 270, 360),
    )
    for x0, z0, a0, a1 in corners:
        for step in range(corner_steps + 1):
            angle = math.radians(a0 + (a1 - a0) * step / corner_steps)
            points.append((x0 + radius * math.cos(angle), y, z0 + radius * math.sin(angle)))
    return points


def add_rounded_frame(name, cx, y, cz, width, height, radius, material, thickness=0.05):
    return add_curve(
        name,
        rounded_rect_points(cx, y, cz, width, height, radius),
        thickness,
        material,
        cyclic=True,
    )


def join_objects(objects, name):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    joined = bpy.context.object
    joined.name = name
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    return joined


def parent_to_bone(obj, rig, bone_name):
    world = obj.matrix_world.copy()
    obj.parent = rig
    obj.parent_type = "BONE"
    obj.parent_bone = bone_name
    obj.matrix_world = world


def parent_keep_world(obj, parent):
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world


def make_armature():
    data = bpy.data.armatures.new("BuddyArmature")
    rig = bpy.data.objects.new("BuddyRig", data)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    spine = data.edit_bones.new("spine")
    spine.head = (0, 0, 0.5)
    spine.tail = (0, 0, 3.15)
    head = data.edit_bones.new("head")
    head.head = (0, 0, 3.15)
    head.tail = (0, 0, 6.3)
    head.parent = spine
    head.use_connect = True
    bpy.ops.object.mode_set(mode="POSE")
    for pose_bone in rig.pose.bones:
        pose_bone.rotation_mode = "XYZ"
    bpy.ops.object.mode_set(mode="OBJECT")
    rig.show_in_front = True
    return rig


def make_eyes(materials):
    parts = []
    for x in (-0.68, 0.68):
        parts.append(add_uv_sphere("Eye bead", (x, -1.78, 4.62), (0.225, 0.075, 0.29), materials["eye"], 32, 20))
        parts.append(add_uv_sphere("Eye glint", (x - 0.047, -1.86, 4.70), (0.047, 0.024, 0.060), materials["glint"], 24, 16))
    for part in parts:
        bpy.ops.object.select_all(action="DESELECT")
        part.select_set(True)
        bpy.context.view_layer.objects.active = part
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    eyes = join_objects(parts, "Eyes")
    bpy.ops.object.shade_smooth()
    basis = eyes.shape_key_add(name="Basis")
    blink = eyes.shape_key_add(name="blink")
    squint = eyes.shape_key_add(name="squint_happy")
    for index, vertex in enumerate(basis.data):
        x, y, z = vertex.co
        center_x = -0.68 if x < 0 else 0.68
        nx = max(-1.0, min(1.0, (x - center_x) / 0.20))
        blink.data[index].co.z = 4.62 + (z - 4.62) * 0.055
        squint.data[index].co.z = 4.59 + 0.16 * (1.0 - abs(nx)) + (z - 4.62) * 0.10
        squint.data[index].co.x = center_x + (x - center_x) * 1.08
    return eyes


def make_mouth(material):
    mouth = add_uv_sphere("Mouth open control", (0, -1.70, 3.78), (0.19, 0.045, 0.028), material, 32, 20)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    basis = mouth.shape_key_add(name="Basis")
    opened = mouth.shape_key_add(name="mouth_open")
    for index, vertex in enumerate(basis.data):
        opened.data[index].co.x = vertex.co.x * 0.86
        opened.data[index].co.z = (vertex.co.z - 3.78) * 5.8 + 3.75
    return mouth


def make_scene(args):
    reset_scene()
    scene = bpy.context.scene
    if args.engine == "eevee":
        try:
            scene.render.engine = "BLENDER_EEVEE"
        except TypeError:
            scene.render.engine = "BLENDER_EEVEE_NEXT"
    else:
        scene.render.engine = "CYCLES"
    scene.render.resolution_x = 160
    scene.render.resolution_y = 160
    scene.render.resolution_percentage = 100
    scene.render.fps = FPS
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 90
    scene.render.use_file_extension = True
    scene.render.use_persistent_data = True
    scene.render.image_settings.color_mode = "RGB"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.world.use_nodes = True
    world_bg = scene.world.node_tree.nodes.get("Background")
    world_bg.inputs["Color"].default_value = hex_color("#F3EBDF")
    world_bg.inputs["Strength"].default_value = 1.0
    if scene.render.engine == "CYCLES":
        scene.cycles.samples = args.samples
        scene.cycles.use_denoising = True
        scene.cycles.preview_samples = min(args.samples, 16)
        scene.cycles.use_adaptive_sampling = True
        scene.cycles.adaptive_threshold = 0.08
        configure_cycles_device(scene, args.device)

    materials = {
        "skin": felt_material("Warm ivory felt", "#E6C8B4", bump=0.11),
        "hair": felt_material("Deep brown felt", "#3C160B", roughness=0.92, bump=0.16),
        "hair_highlight": felt_material("Warm brown hair strands", "#6A2F1D", roughness=0.92, bump=0.10),
        "sweater": felt_material("Mist blue sweater felt", "#8FA6F5", bump=0.18),
        "sweater_dark": felt_material("Mist blue ribbing", "#758DDA", bump=0.2),
        "frame": simple_material("Dark glasses", "#30282A", roughness=0.48),
        "lens": glass_material("Clear lenses"),
        "eye": simple_material("Bean black", "#171313", roughness=0.52),
        "glint": simple_material("Eye glints", "#FFFFFF", roughness=0.24),
        "blush": felt_material("Soft blush", "#ECA7A7", bump=0.07),
        "blush_deep": felt_material("Happy blush", "#E87F87", bump=0.07),
        "mole": simple_material("Beauty mark", "#50352F", roughness=0.72),
        "mouth": simple_material("Smile", "#5B3334", roughness=0.68),
        "dimple": simple_material("Dimple shadow", "#B87468", roughness=0.82),
        "background": simple_material("Cream background", "#F3EBDF", roughness=1.0),
    }
    for hair_material in (materials["hair"], materials["hair_highlight"]):
        set_socket(hair_material.node_tree.nodes.get("Principled BSDF"), ("Sheen Weight", "Sheen"), 0.20)

    rig = make_armature()

    # Keep the shoulder line low and broad. Only its upper arc should enter
    # the portrait crop; a high sphere reads as a detached blue ball.
    torso = add_uv_sphere("Sweater body", (0, 0.18, 0.0), (2.55, 1.18, 1.70), materials["sweater"], 56, 36)
    neck = add_uv_sphere("Neck", (0, -0.02, 2.38), (0.50, 0.48, 0.70), materials["skin"], 40, 28)

    bpy.ops.mesh.primitive_torus_add(major_radius=0.61, minor_radius=0.105, major_segments=56, minor_segments=14, location=(0, -0.46, 2.17))
    collar = bpy.context.object
    collar.name = "Ribbed sweater collar"
    collar.scale = (1.18, 0.82, 0.68)
    collar.data.materials.append(materials["sweater_dark"])
    bpy.ops.object.shade_smooth()
    for index, z in enumerate((1.96, 2.04, 2.12)):
        add_curve(
            f"Collar rib {index}",
            [
                (-0.70, -1.02, z + 0.24),
                (-0.45, -1.10, z + 0.09),
                (0, -1.15, z),
                (0.45, -1.10, z + 0.09),
                (0.70, -1.02, z + 0.24),
            ],
            0.022,
            materials["sweater_dark"],
        )

    hair_back = add_uv_sphere("Hair back", (0, 0.10, 4.55), (2.22, 1.43, 2.62), materials["hair"], 64, 40)
    face = add_uv_sphere("Face", (0, -0.18, 4.48), (1.86, 1.48, 2.23), materials["skin"], 64, 44)
    bpy.context.view_layer.objects.active = face
    face.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for vertex in face.data.vertices:
        if vertex.co.z < 0:
            taper = 1.0 - 0.13 * min(1.0, -vertex.co.z / 2.23)
            vertex.co.x *= taper
    face.select_set(False)
    ear_l = add_uv_sphere("Left ear", (-1.79, -0.15, 4.48), (0.29, 0.35, 0.42), materials["skin"], 32, 22)
    ear_r = add_uv_sphere("Right ear", (1.79, -0.15, 4.48), (0.29, 0.35, 0.42), materials["skin"], 32, 22)

    # Layered curves read as soft, chin-length curtain hair without turning the
    # fringe into two solid helmet pieces.
    hair_parts = [hair_back]
    for side in (-1, 1):
        hair_parts.extend(
            [
                add_curve(
                    f"Outer curtain curl {side}",
                    [
                        (side * 1.42, -1.31, 6.08),
                        (side * 1.68, -1.38, 5.58),
                        (side * 1.88, -1.25, 4.62),
                        (side * 1.73, -1.18, 3.38),
                        (side * 2.00, -1.13, 3.22),
                    ],
                    0.29,
                    materials["hair"],
                ),
                add_curve(
                    f"Middle curtain curl {side}",
                    [
                        (side * 1.06, -1.55, 5.98),
                        (side * 1.30, -1.62, 5.70),
                        (side * 1.55, -1.50, 5.10),
                        (side * 1.58, -1.37, 3.65),
                        (side * 1.78, -1.30, 3.42),
                    ],
                    0.25,
                    materials["hair"],
                ),
                add_curve(
                    f"Flicked end {side}",
                    [
                        (side * 1.48, -1.40, 4.35),
                        (side * 1.52, -1.36, 3.70),
                        (side * 1.38, -1.30, 3.25),
                        (side * 1.69, -1.25, 3.12),
                    ],
                    0.18,
                    materials["hair"],
                ),
            ]
        )

    left_bang = add_hair_panel(
        "Left curtain bang",
        [
            (-0.03, 6.83),
            (-0.48, 6.76),
            (-0.98, 6.48),
            (-1.33, 5.98),
            (-1.42, 5.43),
            (-1.24, 5.14),
            (-1.00, 5.42),
            (-0.61, 6.13),
            (-0.10, 6.55),
        ],
        -1.76,
        0.16,
        materials["hair"],
    )
    right_bang = add_hair_panel(
        "Right curtain bang",
        [(-x, z) for x, z in [
            (-0.03, 6.83),
            (-0.48, 6.76),
            (-0.98, 6.48),
            (-1.33, 5.98),
            (-1.42, 5.43),
            (-1.24, 5.14),
            (-1.00, 5.42),
            (-0.61, 6.13),
            (-0.10, 6.55),
        ]],
        -1.76,
        0.16,
        materials["hair"],
    )
    hair_parts.extend((left_bang, right_bang))
    for side in (-1, 1):
        hair_parts.extend(
            [
                add_curve(
                    f"Inner bang strand {side}",
                    [
                        (side * 0.18, -1.86, 6.63),
                        (side * 0.47, -1.88, 6.43),
                        (side * 0.80, -1.88, 5.96),
                        (side * 1.06, -1.87, 5.38),
                    ],
                    0.025,
                    materials["hair_highlight"],
                ),
                add_curve(
                    f"Outer bang strand {side}",
                    [
                        (side * 0.52, -1.86, 6.59),
                        (side * 0.82, -1.88, 6.34),
                        (side * 1.10, -1.88, 5.88),
                        (side * 1.27, -1.86, 5.40),
                    ],
                    0.021,
                    materials["hair_highlight"],
                ),
            ]
        )

    add_curve("Center part", [(0, -1.79, 6.84), (-0.03, -1.82, 6.60), (0, -1.84, 6.38)], 0.027, materials["skin"])

    eyes = make_eyes(materials)
    gaze = bpy.data.objects.new("Gaze control", None)
    bpy.context.collection.objects.link(gaze)
    gaze.empty_display_type = "PLAIN_AXES"
    parent_keep_world(eyes, gaze)

    for cx in (-0.68, 0.68):
        add_rounded_frame(f"Glasses frame {cx}", cx, -1.94, 4.61, 1.22, 0.80, 0.17, materials["frame"], thickness=0.043)
        add_curve(
            f"Lens highlight {cx}",
            [(cx - 0.34, -1.97, 4.87), (cx - 0.24, -1.98, 4.92), (cx - 0.11, -1.97, 4.94)],
            0.018,
            materials["glint"],
        )
    add_curve("Glasses bridge", [(-0.08, -1.95, 4.63), (0, -2.00, 4.70), (0.08, -1.95, 4.63)], 0.044, materials["frame"])
    add_curve("Left temple", [(-1.29, -1.92, 4.66), (-1.55, -1.62, 4.69), (-1.72, -1.18, 4.62)], 0.040, materials["frame"])
    add_curve("Right temple", [(1.29, -1.92, 4.66), (1.55, -1.62, 4.69), (1.72, -1.18, 4.62)], 0.040, materials["frame"])

    brow_l = add_curve("Left eyebrow", [(-0.95, -1.70, 5.13), (-0.68, -1.75, 5.21), (-0.42, -1.71, 5.17)], 0.035, materials["hair"])
    brow_r = add_curve("Right eyebrow", [(0.42, -1.71, 5.17), (0.68, -1.75, 5.21), (0.95, -1.70, 5.13)], 0.035, materials["hair"])

    blush_l = add_uv_sphere("Left blush", (-1.12, -1.62, 4.00), (0.34, 0.045, 0.16), materials["blush"], 32, 20)
    blush_r = add_uv_sphere("Right blush", (1.12, -1.62, 4.00), (0.34, 0.045, 0.16), materials["blush"], 32, 20)
    deep_l = add_uv_sphere("Left happy blush", (-1.12, -1.68, 4.00), (0.37, 0.040, 0.18), materials["blush_deep"], 32, 20)
    deep_r = add_uv_sphere("Right happy blush", (1.12, -1.68, 4.00), (0.37, 0.040, 0.18), materials["blush_deep"], 32, 20)
    deep_base = {deep_l.name: deep_l.scale.copy(), deep_r.name: deep_r.scale.copy()}

    nose = add_curve("Small nose", [(-0.055, -1.73, 4.18), (0.01, -1.76, 4.11), (0.075, -1.73, 4.15)], 0.022, materials["mouth"])
    smile = add_curve("Small smile", [(-0.27, -1.76, 3.85), (0, -1.80, 3.73), (0.27, -1.76, 3.85)], 0.038, materials["mouth"])
    mouth = make_mouth(materials["mouth"])
    dimple_l = add_curve("Left dimple", [(-0.48, -1.72, 3.88), (-0.54, -1.73, 3.82), (-0.49, -1.72, 3.76)], 0.022, materials["dimple"])
    dimple_r = add_curve("Right dimple", [(0.48, -1.72, 3.88), (0.54, -1.73, 3.82), (0.49, -1.72, 3.76)], 0.022, materials["dimple"])

    spine_objects = [torso, neck, collar]
    spine_objects.extend([obj for obj in bpy.context.scene.objects if obj.name.startswith("Collar rib")])
    head_objects = [face, ear_l, ear_r, *hair_parts, brow_l, brow_r, blush_l, blush_r, deep_l, deep_r, nose, smile, mouth, dimple_l, dimple_r, gaze]
    head_objects.extend(
        [
            obj
            for obj in bpy.context.scene.objects
            if obj.name.startswith(("Glasses", "Lens highlight", "Left temple", "Right temple", "Center part"))
        ]
    )
    for obj in spine_objects:
        parent_to_bone(obj, rig, "spine")
    for obj in dict.fromkeys(head_objects):
        parent_to_bone(obj, rig, "head")

    # Camera: a long orthographic lens with a small downward angle, like a
    # tabletop character portrait rather than a flat icon.
    bpy.ops.object.camera_add(location=(0, -14.5, 6.95))
    camera = bpy.context.object
    camera.name = "Buddy portrait camera"
    point_camera(camera, (0, 0, 3.80))
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 7.45
    camera.data.lens = 58
    scene.camera = camera

    add_area_light("Warm key", (-4.8, -6.2, 9.3), 280, 5.0, "#FFE4C2", (0, 0, 4.2))
    add_area_light("Soft fill", (4.8, -3.2, 6.1), 85, 4.5, "#DCE7FF", (0, 0, 4.1))
    add_area_light("Hair rim", (2.7, 1.4, 8.2), 95, 3.2, "#FFF1D9", (0, 0, 5.0))

    controls = {
        "rig": rig,
        "eyes": eyes,
        "eyes_keys": eyes.data.shape_keys,
        "mouth": mouth,
        "mouth_keys": mouth.data.shape_keys,
        "gaze": gaze,
        "deep_l": deep_l,
        "deep_r": deep_r,
        "deep_base": deep_base,
    }
    clip_actions = build_actions(controls)
    scene["buddy_clips"] = json.dumps({name: spec for name, spec in CLIPS.items()})
    scene["buddy_action_map"] = json.dumps(
        {clip: {target: action.name for target, action in actions.items()} for clip, actions in clip_actions.items()}
    )
    apply_clip(scene, controls, clip_actions, "idle")
    scene.frame_set(1)
    return scene, controls, clip_actions


def configure_cycles_device(scene, requested):
    if requested == "cpu":
        scene.cycles.device = "CPU"
        return
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.get_devices()
        if sys.platform == "darwin":
            prefs.compute_device_type = "METAL"
        elif requested == "gpu":
            prefs.compute_device_type = "CUDA"
        devices = [device for group in prefs.get_devices() for device in group]
        usable = [device for device in devices if device.type != "CPU"]
        if not usable:
            if requested == "gpu":
                raise RuntimeError("No supported Cycles GPU was found")
            scene.cycles.device = "CPU"
            return
        for device in devices:
            device.use = device in usable
        scene.cycles.device = "GPU"
        print("Cycles devices:", ", ".join(device.name for device in usable))
    except Exception as exc:
        if requested == "gpu":
            raise
        print(f"Cycles GPU setup skipped ({exc}); using CPU")
        scene.cycles.device = "CPU"


def point_camera(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_area_light(name, location, energy, size, color, target):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = hex_color(color)[:3]
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    point_camera(obj, target)
    return obj


def new_action(target, name):
    target.animation_data_clear()
    target.animation_data_create()
    action = bpy.data.actions.new(name)
    target.animation_data.action = action
    return action


def key_rig(rig, frame, rig_z=0.0, head=(0.0, 0.0, 0.0), spine=(0.0, 0.0, 0.0), breath=1.0):
    rig.location = (0, 0, rig_z)
    rig.keyframe_insert("location", frame=frame)
    head_bone = rig.pose.bones["head"]
    head_bone.rotation_euler = head
    head_bone.keyframe_insert("rotation_euler", frame=frame)
    spine_bone = rig.pose.bones["spine"]
    spine_bone.rotation_euler = spine
    spine_bone.scale = (1.0, 1.0, breath)
    spine_bone.keyframe_insert("rotation_euler", frame=frame)
    spine_bone.keyframe_insert("scale", frame=frame)


def key_shapes(keys, frame, blink=0.0, squint=0.0):
    keys.key_blocks["blink"].value = blink
    keys.key_blocks["squint_happy"].value = squint
    keys.keyframe_insert('key_blocks["blink"].value', frame=frame)
    keys.keyframe_insert('key_blocks["squint_happy"].value', frame=frame)


def key_mouth(keys, frame, amount=0.0):
    keys.key_blocks["mouth_open"].value = amount
    keys.keyframe_insert('key_blocks["mouth_open"].value', frame=frame)


def key_gaze(gaze, frame, x=0.0, z=0.0):
    # delta_location keeps the bone-parent offset intact while the pupils move
    # a few millimeters across the face.
    gaze.delta_location = (x, 0, z)
    gaze.keyframe_insert("delta_location", frame=frame)


def key_blush(obj, base_scale, frame, amount=0.0):
    factor = max(0.001, amount)
    obj.scale = base_scale * factor
    obj.keyframe_insert("scale", frame=frame)


def finish_action(action, interpolation="BEZIER"):
    # Blender 5 stores curves in layered channel bags rather than exposing the
    # legacy action.fcurves collection. Its inserted-key default is Bezier, so
    # leaving those handles alone gives the same eased motion.
    if not hasattr(action, "fcurves"):
        return
    for fcurve in action.fcurves:
        for key in fcurve.keyframe_points:
            key.interpolation = interpolation
            key.handle_left_type = "AUTO_CLAMPED"
            key.handle_right_type = "AUTO_CLAMPED"


def build_actions(controls):
    rig = controls["rig"]
    eyes_keys = controls["eyes_keys"]
    mouth_keys = controls["mouth_keys"]
    gaze = controls["gaze"]
    deep_l = controls["deep_l"]
    deep_r = controls["deep_r"]
    base_l = controls["deep_base"][deep_l.name]
    base_r = controls["deep_base"][deep_r.name]
    result = {}

    rig_tracks = {
        "idle": [
            (1, 0, (0, 0, 0), (0, 0, 0), 1.0),
            (13, 0.02, (0, math.radians(0.8), 0), (0, 0, math.radians(0.35)), 1.014),
            (25, 0, (0, 0, 0), (0, 0, 0), 1.0),
            (37, -0.01, (0, math.radians(-0.8), 0), (0, 0, math.radians(-0.35)), 0.989),
            (49, 0, (0, 0, 0), (0, 0, 0), 1.0),
        ],
        "blink": [(1, 0, (0, 0, 0), (0, 0, 0), 1), (4, 0, (0, 0, 0), (0, 0, 0), 1)],
        "hello": [
            (1, 0, (0, 0, 0), (0, 0, 0), 1),
            (4, 0.22, (math.radians(-1.5), math.radians(-3), 0), (0, 0, math.radians(-1)), 1.02),
            (7, 0.06, (0, math.radians(2), 0), (0, 0, math.radians(0.5)), 1),
            (10, 0, (0, 0, 0), (0, 0, 0), 1),
        ],
        "listening": [
            (1, 0, (0, math.radians(6), 0), (0, 0, 0), 1),
            (7, 0.015, (math.radians(0.4), math.radians(6.8), 0), (0, 0, math.radians(0.25)), 1.008),
            (13, 0, (0, math.radians(6), 0), (0, 0, 0), 1),
            (19, -0.005, (math.radians(-0.4), math.radians(5.2), 0), (0, 0, math.radians(-0.25)), 0.995),
            (25, 0, (0, math.radians(6), 0), (0, 0, 0), 1),
        ],
        "nod": [
            (1, 0, (0, math.radians(6), 0), (0, 0, 0), 1),
            (2, 0, (math.radians(5), math.radians(6), 0), (0, 0, 0), 1),
            (3, 0, (math.radians(-1.5), math.radians(6), 0), (0, 0, 0), 1),
            (4, 0, (0, math.radians(6), 0), (0, 0, 0), 1),
        ],
        "thinking": [
            (1, 0, (0, math.radians(-8), 0), (0, 0, 0), 1),
            (7, 0.012, (math.radians(-0.4), math.radians(-7), 0), (0, 0, math.radians(-0.25)), 1.008),
            (13, 0, (0, math.radians(-8), 0), (0, 0, 0), 1),
            (19, -0.006, (math.radians(0.4), math.radians(-9), 0), (0, 0, math.radians(0.25)), 0.994),
            (25, 0, (0, math.radians(-8), 0), (0, 0, 0), 1),
        ],
        "talking": [
            (1, 0, (0, 0, 0), (0, 0, 0), 1),
            (4, 0.012, (math.radians(1.2), math.radians(0.6), 0), (0, 0, 0), 1.006),
            (7, 0, (math.radians(-1), math.radians(-0.5), 0), (0, 0, 0), 1),
            (10, 0.008, (math.radians(0.7), math.radians(0.3), 0), (0, 0, 0), 1.004),
            (13, 0, (0, 0, 0), (0, 0, 0), 1),
        ],
        "happy": [
            (1, 0, (0, 0, 0), (0, 0, 0), 1),
            (4, 0.24, (math.radians(-1), math.radians(-2.5), 0), (0, 0, math.radians(-0.8)), 1.02),
            (7, 0.16, (0, math.radians(2), 0), (0, 0, math.radians(0.6)), 1.01),
            (10, 0.03, (0, math.radians(-0.6), 0), (0, 0, 0), 1),
            (12, 0, (0, 0, 0), (0, 0, 0), 1),
        ],
    }

    shape_tracks = {
        "idle": [(1, 0, 0), (49, 0, 0)],
        "blink": [(1, 0, 0), (2, 1, 0), (3, 1, 0), (4, 0, 0)],
        "hello": [(1, 0, 0), (4, 0, 1), (7, 0, 1), (10, 0, 0)],
        "listening": [(1, 0, 0), (25, 0, 0)],
        "nod": [(1, 0, 0), (4, 0, 0)],
        "thinking": [(1, 0, 0), (25, 0, 0)],
        "talking": [(1, 0, 0), (13, 0, 0)],
        "happy": [(1, 0, 0), (3, 0, 1), (9, 0, 1), (12, 0, 0)],
    }
    mouth_tracks = {
        "idle": [(1, 0), (49, 0)],
        "blink": [(1, 0), (4, 0)],
        "hello": [(1, 0), (10, 0)],
        "listening": [(1, 0), (25, 0)],
        "nod": [(1, 0), (4, 0)],
        "thinking": [(1, 0), (25, 0)],
        "talking": [(1, 0), (3, 1), (6, 0.08), (9, 0.92), (13, 0)],
        "happy": [(1, 0), (12, 0)],
    }
    gaze_tracks = {
        "idle": [(1, 0, 0), (49, 0, 0)],
        "blink": [(1, 0, 0), (4, 0, 0)],
        "hello": [(1, 0, 0), (10, 0, 0)],
        "listening": [(1, 0.12, -0.075), (13, 0.11, -0.065), (25, 0.12, -0.075)],
        "nod": [(1, 0.12, -0.075), (4, 0.12, -0.075)],
        "thinking": [(1, -0.12, 0.09), (13, -0.10, 0.08), (25, -0.12, 0.09)],
        "talking": [(1, 0, 0), (13, 0, 0)],
        "happy": [(1, 0, 0), (12, 0, 0)],
    }
    blush_tracks = {
        clip: [(1, 0), (CLIPS[clip]["frames"] + (1 if CLIPS[clip]["loop"] else 0), 0)] for clip in CLIPS
    }
    blush_tracks["happy"] = [(1, 0), (3, 1), (9, 1), (12, 0)]

    for clip in CLIPS:
        actions = {}
        actions["rig"] = new_action(rig, f"buddy_{clip}")
        for key in rig_tracks[clip]:
            key_rig(rig, *key)
        finish_action(actions["rig"])

        actions["eyes_keys"] = new_action(eyes_keys, f"face_{clip}")
        for frame, blink, squint in shape_tracks[clip]:
            key_shapes(eyes_keys, frame, blink, squint)
        finish_action(actions["eyes_keys"], "BEZIER")

        actions["mouth_keys"] = new_action(mouth_keys, f"mouth_{clip}")
        for frame, amount in mouth_tracks[clip]:
            key_mouth(mouth_keys, frame, amount)
        finish_action(actions["mouth_keys"], "BEZIER")

        actions["gaze"] = new_action(gaze, f"gaze_{clip}")
        for frame, x, z in gaze_tracks[clip]:
            key_gaze(gaze, frame, x, z)
        finish_action(actions["gaze"])

        for label, obj, base in (("deep_l", deep_l, base_l), ("deep_r", deep_r, base_r)):
            actions[label] = new_action(obj, f"{label}_{clip}")
            for frame, amount in blush_tracks[clip]:
                key_blush(obj, base, frame, amount)
            finish_action(actions[label], "BEZIER")
        result[clip] = actions
    return result


def apply_clip(scene, controls, clip_actions, clip):
    for target, action in clip_actions[clip].items():
        controls[target].animation_data.action = action
    scene.frame_start = 1
    scene.frame_end = CLIPS[clip]["frames"]
    scene.frame_set(1)


def render_still(scene, output_dir):
    output_dir.mkdir(parents=True, exist_ok=True)
    old_format = scene.render.image_settings.file_format
    scene.render.image_settings.file_format = "WEBP"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.quality = 84
    scene.render.filepath = str(output_dir / "still.webp")
    scene.frame_set(1)
    bpy.ops.render.render(write_still=True)
    scene.render.image_settings.file_format = old_format
    print(f"Rendered {output_dir / 'still.webp'}")


def render_clips(scene, controls, clip_actions, frames_dir, names):
    frames_dir.mkdir(parents=True, exist_ok=True)
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    for clip in names:
        apply_clip(scene, controls, clip_actions, clip)
        target = frames_dir / clip
        target.mkdir(parents=True, exist_ok=True)
        scene.render.filepath = str(target / f"{clip}_")
        print(f"Rendering {clip}: {CLIPS[clip]['frames']} frames -> {target}")
        bpy.ops.render.render(animation=True)


def main():
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[2]
    output_dir = args.output_dir or repo_root / "media" / "buddy"
    scene, controls, clip_actions = make_scene(args)

    if args.preview:
        output_dir.mkdir(parents=True, exist_ok=True)
        apply_clip(scene, controls, clip_actions, "idle")
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = str(output_dir / "preview.png")
        scene.frame_set(1)
        bpy.ops.render.render(write_still=True)
        print(f"Rendered {output_dir / 'preview.png'}")

    if args.render:
        clips = list(CLIPS) if args.clip == "all" else [args.clip]
        apply_clip(scene, controls, clip_actions, "idle")
        render_still(scene, output_dir)
        render_clips(scene, controls, clip_actions, args.frames_dir, clips)

    if args.save_blend:
        args.save_blend.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(args.save_blend))
        print(f"Saved {args.save_blend}")

    if not (args.preview or args.render or args.save_blend):
        print("Scene built. Add --preview, --render, or --save-blend to write output.")


if __name__ == "__main__":
    main()
