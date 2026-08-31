#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using GLTFast;
using GLTFast.Export;
using UnityEditor;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Corealm.EditorTools
{
    /// <summary>
    /// Converts the four licensed Unity Asset Store prefabs used by Corealm's
    /// magic equipment and essence caches into self-contained binary glTF files.
    /// The PowerShell wrapper copies this file into a disposable Unity project.
    /// </summary>
    public static class CorealmMagicAssetExporter
    {
        private const string OutputEnvironmentVariable = "COREALM_MAGIC_ASSET_OUTPUT";

        private sealed class Source
        {
            public string Id;
            public string Prefab;
            public string Albedo;
            public string Normal;
            public bool BrownOnly;
            public bool HighestLodOnly;
        }

        private static readonly Source[] Sources =
        {
            new Source
            {
                Id = "rpg_weapon_staff",
                Prefab = "Assets/Blink/Art/Weapons/LowPoly/FreeRPGWeapons/_PREFABS/Staff_Basic.prefab",
                Albedo = "Assets/Blink/Art/Weapons/LowPoly/FreeRPGWeapons/Staff/Staff_Textures/Staff_Basic_BaseColor.png",
                Normal = "Assets/Blink/Art/Weapons/LowPoly/FreeRPGWeapons/Staff/Staff_Textures/Staff_Basic_Normal.png",
                BrownOnly = true,
            },
            new Source
            {
                Id = "rpg_weapon_wand",
                Prefab = "Assets/Blink/Art/Weapons/LowPoly/FreeRPGWeapons/_PREFABS/Wand_Basic.prefab",
                Albedo = "Assets/Blink/Art/Weapons/LowPoly/FreeRPGWeapons/Wand/Wand_Textures/Wand_Basic_BaseColor.png",
                Normal = "Assets/Blink/Art/Weapons/LowPoly/FreeRPGWeapons/Wand/Wand_Textures/Wand_Basic__Normal.png",
                BrownOnly = true,
            },
            new Source
            {
                Id = "rocks_free_essence_cache",
                Prefab = "Assets/RockFREE/LODGroups/rock5_LOD0.prefab",
                Albedo = "Assets/RockFREE/Textures/rock5_Albedo.png",
                Normal = "Assets/RockFREE/Textures/rock5_Normal.png",
                BrownOnly = false,
                HighestLodOnly = true,
            },
            new Source
            {
                Id = "rocks_free_essence_node",
                Prefab = "Assets/RockFREE/LODGroups/rock2_LOD0.prefab",
                Albedo = "Assets/RockFREE/Textures/rock2_Albedo.png",
                Normal = "Assets/RockFREE/Textures/rock2_Normal.png",
                BrownOnly = false,
                HighestLodOnly = true,
            },
        };

        /// <summary>
        /// Unity command-line entry point. This method owns process exit because
        /// the glTF writer completes asynchronously.
        /// </summary>
        public static async void Run()
        {
            try
            {
                var output = Environment.GetEnvironmentVariable(OutputEnvironmentVariable);
                if (string.IsNullOrWhiteSpace(output))
                {
                    throw new InvalidOperationException($"Set {OutputEnvironmentVariable} to the destination directory.");
                }

                output = Path.GetFullPath(output);
                Directory.CreateDirectory(output);
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);

                foreach (var source in Sources)
                {
                    await ExportOne(source, output);
                }

                Debug.Log($"CORealM magic asset export complete: {output}");
                EditorApplication.Exit(0);
            }
            catch (Exception exception)
            {
                Debug.LogException(exception);
                EditorApplication.Exit(1);
            }
        }

        private static async Task ExportOne(Source source, string output)
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(source.Prefab);
            if (prefab == null)
            {
                throw new FileNotFoundException($"Unity prefab was not imported: {source.Prefab}");
            }

            var instance = PrefabUtility.InstantiatePrefab(prefab) as GameObject;
            if (instance == null)
            {
                throw new InvalidOperationException($"Could not instantiate {source.Prefab}");
            }

            Material material = null;
            Texture2D generatedAlbedo = null;
            try
            {
                instance.name = source.Id;
                instance.transform.position = Vector3.zero;
                if (source.HighestLodOnly)
                {
                    KeepHighestDetailLod(instance);
                }

                var albedo = source.BrownOnly
                    ? CreateBrownAlbedo(source.Albedo, source.Id)
                    : RequireTexture(source.Albedo);
                if (source.BrownOnly)
                {
                    generatedAlbedo = albedo;
                }

                material = CreateNonEmissiveMaterial(
                    $"{source.Id}_material",
                    albedo,
                    RequireTexture(source.Normal),
                    source.BrownOnly
                );

                var renderers = instance.GetComponentsInChildren<Renderer>(true);
                if (renderers.Length == 0)
                {
                    throw new InvalidOperationException($"Prefab has no renderers: {source.Prefab}");
                }

                foreach (var renderer in renderers)
                {
                    var count = Math.Max(1, renderer.sharedMaterials.Length);
                    renderer.sharedMaterials = Enumerable.Repeat(material, count).ToArray();
                }

                var bounds = CombinedBounds(renderers);
                var meshes = instance.GetComponentsInChildren<MeshFilter>(true)
                    .Select(filter => filter.sharedMesh)
                    .Where(mesh => mesh != null)
                    .Distinct()
                    .ToArray();
                var vertices = meshes.Sum(mesh => mesh.vertexCount);
                var triangles = meshes.Sum(mesh => mesh.triangles.Length / 3);
                Debug.Log(
                    $"SOURCE_METRICS {source.Id} " +
                    $"size=({bounds.size.x:F6},{bounds.size.y:F6},{bounds.size.z:F6}) " +
                    $"min=({bounds.min.x:F6},{bounds.min.y:F6},{bounds.min.z:F6}) " +
                    $"vertices={vertices} triangles={triangles}"
                );

                var settings = new ExportSettings
                {
                    Format = GltfFormat.Binary,
                    ImageDestination = ImageDestination.MainBuffer,
                    FileConflictResolution = FileConflictResolution.Overwrite,
                    Compression = Compression.Uncompressed,
                    ComponentMask = ComponentType.Mesh,
                    Deterministic = true,
                    JpgQuality = 90,
                };
                var exporter = new GameObjectExport(settings);
                if (!exporter.AddScene(new[] { instance }, source.Id))
                {
                    throw new InvalidOperationException($"glTFast rejected scene {source.Id}");
                }

                var destination = Path.Combine(output, $"{source.Id}.glb");
                if (!await exporter.SaveToFileAndDispose(destination))
                {
                    throw new IOException($"glTFast could not write {destination}");
                }

                Debug.Log($"EXPORTED {source.Id} {new FileInfo(destination).Length} bytes -> {destination}");
            }
            finally
            {
                Object.DestroyImmediate(instance);
                if (material != null) Object.DestroyImmediate(material);
                if (generatedAlbedo != null) Object.DestroyImmediate(generatedAlbedo);
            }
        }

        private static Texture2D RequireTexture(string assetPath)
        {
            var texture = AssetDatabase.LoadAssetAtPath<Texture2D>(assetPath);
            if (texture == null)
            {
                throw new FileNotFoundException($"Unity texture was not imported: {assetPath}");
            }
            return texture;
        }

        /// <summary>
        /// Keeps the basic pack texture's shading and painted detail while
        /// mapping every opaque pixel onto a dark-to-light wood-brown ramp.
        /// </summary>
        private static Texture2D CreateBrownAlbedo(string assetPath, string id)
        {
            var projectRoot = Directory.GetParent(Application.dataPath)?.FullName;
            if (string.IsNullOrEmpty(projectRoot))
            {
                throw new InvalidOperationException("Unity project root could not be resolved.");
            }

            var absolutePath = Path.Combine(projectRoot, assetPath.Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(absolutePath))
            {
                throw new FileNotFoundException($"Source albedo is missing: {assetPath}", absolutePath);
            }

            var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false, false)
            {
                name = $"{id}_brown_albedo",
                filterMode = FilterMode.Bilinear,
                wrapMode = TextureWrapMode.Repeat,
            };
            if (!texture.LoadImage(File.ReadAllBytes(absolutePath), false))
            {
                Object.DestroyImmediate(texture);
                throw new InvalidDataException($"Unity could not decode {assetPath}");
            }

            var pixels = texture.GetPixels();
            var darkest = new Color(0.075f, 0.026f, 0.010f, 1f);
            var lightest = new Color(0.54f, 0.255f, 0.075f, 1f);
            for (var index = 0; index < pixels.Length; index += 1)
            {
                var source = pixels[index];
                var luminance = Mathf.Clamp01(0.2126f * source.r + 0.7152f * source.g + 0.0722f * source.b);
                var brown = Color.Lerp(darkest, lightest, Mathf.Pow(luminance, 0.82f));
                brown.a = source.a;
                pixels[index] = brown;
            }
            texture.SetPixels(pixels);
            texture.Apply(false, false);
            return texture;
        }

        private static Material CreateNonEmissiveMaterial(
            string name,
            Texture2D albedo,
            Texture2D normal,
            bool wood
        )
        {
            var shader = Shader.Find("Standard");
            if (shader == null)
            {
                throw new InvalidOperationException("Unity's Standard shader is unavailable.");
            }

            var material = new Material(shader) { name = name };
            material.SetTexture("_MainTex", albedo);
            material.SetColor("_Color", Color.white);
            material.SetFloat("_Metallic", wood ? 0f : 0.08f);
            material.SetFloat("_Glossiness", wood ? 0.18f : 0.24f);
            material.SetTexture("_BumpMap", normal);
            material.SetFloat("_BumpScale", 1f);
            material.EnableKeyword("_NORMALMAP");
            material.SetColor("_EmissionColor", Color.black);
            material.SetTexture("_EmissionMap", null);
            material.DisableKeyword("_EMISSION");
            return material;
        }

        private static Bounds CombinedBounds(Renderer[] renderers)
        {
            var bounds = renderers[0].bounds;
            for (var index = 1; index < renderers.Length; index += 1)
            {
                bounds.Encapsulate(renderers[index].bounds);
            }
            return bounds;
        }

        /// <summary>
        /// DEXSOFT's files named rock*_LOD0.prefab contain the full LOD group,
        /// including a scaled built-in cube at the last rung. Export only the
        /// renderers registered in the group's first, highest-detail LOD.
        /// </summary>
        private static void KeepHighestDetailLod(GameObject instance)
        {
            var lodGroup = instance.GetComponentInChildren<LODGroup>(true);
            if (lodGroup == null)
            {
                throw new InvalidOperationException($"Expected an LODGroup in {instance.name}");
            }

            var lods = lodGroup.GetLODs();
            if (lods.Length == 0 || lods[0].renderers.Length == 0)
            {
                throw new InvalidOperationException($"Expected a highest-detail renderer in {instance.name}");
            }

            var keep = new HashSet<Renderer>(lods[0].renderers);
            foreach (var renderer in instance.GetComponentsInChildren<Renderer>(true))
            {
                if (!keep.Contains(renderer))
                {
                    Object.DestroyImmediate(renderer.gameObject);
                }
            }
            Object.DestroyImmediate(lodGroup);
        }
    }
}
#endif
