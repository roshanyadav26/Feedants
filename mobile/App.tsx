import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { fetch as expoFetch } from "expo/fetch";
import { File } from "expo-file-system";
import { API_BASE_URL } from "./config";

type Competition = {
  title: string;
  category: string;
  description: string;
  prizePool: number;
  entryFee: number;
  maxParticipants: number;
  registeredCount: number;
  registrationClosesAt: string;
  registrationStatus: string;
  competitionStatus: string;
  remainingSpots: number;
  isFull: boolean;
};

type CompetitionTab = "About" | "Judging" | "Rules" | "Eligibility";

export default function App() {
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [participantName, setParticipantName] = useState("");
  const [email, setEmail] = useState("");
  const [registering, setRegistering] = useState(false);

  const [activeTab, setActiveTab] = useState<CompetitionTab>("About");

  const [selectedVideo, setSelectedVideo] = useState<File | null>(null);
  const [entryName, setEntryName] = useState("");
  const [entryEmail, setEntryEmail] = useState("");
  const [pickingVideo, setPickingVideo] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);

  async function loadCompetition() {
    try {
      setError("");

      const response = await fetch(
        `${API_BASE_URL}/competitions/dance-championship-2026`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Could not load competition.");
      }

      setCompetition(data);
    } catch {
      setError(
        "Could not load competition. Check that the backend is running and your phone is on the same Wi-Fi."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCompetition();
  }, []);

  async function handleRegister() {
    if (!participantName.trim() || !email.trim()) {
      Alert.alert("Missing details", "Please enter your name and email.");
      return;
    }

    setRegistering(true);

    try {
      const response = await fetch(
        `${API_BASE_URL}/competitions/dance-championship-2026/register`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            participantName: participantName.trim(),
            email: email.trim().toLowerCase(),
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Registration failed.");
      }

      Alert.alert(
        "Registration created",
        "Your registration has been created. Payment is still pending."
      );

      setParticipantName("");
      setEmail("");
      await loadCompetition();
    } catch (err) {
      Alert.alert(
        "Registration failed",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setRegistering(false);
    }
  }

  async function handleChooseVideo() {
    try {
      setPickingVideo(true);

      const pickerResult = await File.pickFileAsync({
        mimeTypes: ["video/*"],
      });

      // User cancelled the picker.
      if (pickerResult.canceled) {
        return;
      }

      // For a single file, Expo returns the selected File in "result".
      const file = pickerResult.result;

      if (!file) {
        Alert.alert("No video selected", "Please choose a video file.");
        return;
      }

      if (file.type && !file.type.startsWith("video/")) {
        Alert.alert("Invalid file", "Please select a video file.");
        return;
      }

      if (file.size > 100 * 1024 * 1024) {
        Alert.alert("Video too large", "Please select a video under 100 MB.");
        return;
      }

      setSelectedVideo(file);
    } catch (err) {
      Alert.alert(
        "Unable to select video",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setPickingVideo(false);
    }
  }

 async function handleUploadVideo() {
  if (!entryName.trim() || !entryEmail.trim()) {
    Alert.alert(
      "Missing details",
      "Enter your name and email before uploading."
    );
    return;
  }

  if (!selectedVideo) {
    Alert.alert("No video selected", "Please choose a dance video first.");
    return;
  }

  setUploadingVideo(true);

  try {
    const formData = new FormData();

    formData.append("participantName", entryName.trim());
    formData.append("email", entryEmail.trim().toLowerCase());
    formData.append("competitionSlug", "dance-championship-2026");
    formData.append("video", selectedVideo);

    const response = await expoFetch(
      `${API_BASE_URL}/entries/upload`,
      {
        method: "POST",
        body: formData,
      }
    );

    // Read response as text first so HTML/plain-text errors are visible.
    const responseText = await response.text();

    let data: any;

    try {
      data = JSON.parse(responseText);
    } catch {
      const preview = responseText.slice(0, 700);

      throw new Error(
        `Server returned non-JSON data.\nHTTP status: ${response.status}\nResponse: ${preview || "(empty response)"}`
      );
    }

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}: ${
          data.message || "Video upload failed."
        }`
      );
    }

    Alert.alert(
      "Video uploaded",
      "Your video was saved on the backend. Payment status is unchanged."
    );

    setSelectedVideo(null);
    setEntryName("");
    setEntryEmail("");
  } catch (err) {
    Alert.alert(
      "Upload failed",
      err instanceof Error ? err.message : "Please try again."
    );
  } finally {
    setUploadingVideo(false);
  }
}
  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#6558D3" />
        <Text style={styles.message}>Loading competition...</Text>
      </SafeAreaView>
    );
  }

  if (error || !competition) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.error}>
          {error || "Competition not found."}
        </Text>

        <Pressable style={styles.retryButton} onPress={loadCompetition}>
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const registrationClosed =
    competition.registrationStatus !== "open" || competition.isFull;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.category}>
          {competition.category.toUpperCase()}
        </Text>

        <Text style={styles.title}>{competition.title}</Text>
        <Text style={styles.description}>{competition.description}</Text>

        <View style={styles.statusRow}>
          <Text style={styles.status}>
            Registration: {competition.registrationStatus}
          </Text>

          <Text style={styles.status}>
            Event: {competition.competitionStatus}
          </Text>
        </View>

        {/* Competition summary */}
        <View style={styles.card}>
          <Text style={styles.label}>Prize Pool</Text>
          <Text style={styles.prize}>
            ₹{competition.prizePool.toLocaleString("en-IN")}
          </Text>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <Text style={styles.label}>Entry Fee</Text>
            <Text style={styles.value}>₹{competition.entryFee}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.label}>Participants</Text>
            <Text style={styles.value}>
              {competition.registeredCount} / {competition.maxParticipants}
            </Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.label}>Slots Remaining</Text>
            <Text style={styles.value}>{competition.remainingSpots}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.label}>Registration Closes</Text>
            <Text style={styles.value}>
              {new Date(
                competition.registrationClosesAt
              ).toLocaleDateString()}
            </Text>
          </View>
        </View>

        {/* Information tabs */}
        <View style={styles.tabsContainer}>
          {(
            ["About", "Judging", "Rules", "Eligibility"] as CompetitionTab[]
          ).map((tab) => (
            <Pressable
              key={tab}
              style={[
                styles.tabButton,
                activeTab === tab && styles.activeTabButton,
              ]}
              onPress={() => setActiveTab(tab)}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === tab && styles.activeTabText,
                ]}
              >
                {tab}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.card}>
          {activeTab === "About" && (
            <>
              <Text style={styles.sectionTitle}>About the Competition</Text>
              <Text style={styles.description}>
                Show your talent and compete with dancers from across the
                community. Participants can showcase their dance performance
                and compete for the prize pool.
              </Text>
            </>
          )}

          {activeTab === "Judging" && (
            <>
              <Text style={styles.sectionTitle}>Judging Criteria</Text>
              <Text style={styles.description}>
                Performances will be evaluated based on creativity, technique,
                synchronization, stage presence, and overall performance.
              </Text>
            </>
          )}

          {activeTab === "Rules" && (
            <>
              <Text style={styles.sectionTitle}>Competition Rules</Text>
              <Text style={styles.description}>
                {"1. Submit an original dance performance.\n\n"}
                {
                  "2. Ensure that your video is clear and the full performance is visible.\n\n"
                }
                {
                  "3. Keep your performance appropriate for a community event.\n\n"
                }
                {
                  "4. Follow the competition's submission instructions.\n\n"
                }
                {
                  "5. The organizers' final decision will determine the winners."
                }
              </Text>
            </>
          )}

          {activeTab === "Eligibility" && (
            <>
              <Text style={styles.sectionTitle}>Eligibility</Text>
              <Text style={styles.description}>
                Participants should provide accurate registration details and
                follow the competition rules. Make sure you have permission
                to submit any music or content included in your performance.
              </Text>
            </>
          )}
        </View>

        {/* Judges */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Meet the Judges</Text>
          <Text style={styles.description}>
            Our judging panel will evaluate creativity, technique, and
            performance.
          </Text>

          <View style={styles.personRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>J1</Text>
            </View>

            <View style={styles.personInfo}>
              <Text style={styles.personName}>Judge One</Text>
              <Text style={styles.personRole}>Dance and choreography</Text>
            </View>
          </View>

          <View style={styles.personRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>J2</Text>
            </View>

            <View style={styles.personInfo}>
              <Text style={styles.personName}>Judge Two</Text>
              <Text style={styles.personRole}>Performance and technique</Text>
            </View>
          </View>
        </View>

        {/* Winners */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Winners</Text>
          <Text style={styles.description}>
            Winners will be announced after the competition ends.
          </Text>

          {[1, 2, 3].map((place) => (
            <View style={styles.winnerRow} key={place}>
              <Text style={styles.winnerMedal}>{place}</Text>

              <View style={styles.personInfo}>
                <Text style={styles.personName}>
                  {place === 1
                    ? "First Place"
                    : place === 2
                    ? "Second Place"
                    : "Third Place"}
                </Text>

                <Text style={styles.personRole}>
                  Winner announcement pending
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* Upload entry */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Upload Your Entry</Text>
          <Text style={styles.description}>
            Enter your details and upload your dance performance video.
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Participant name"
            value={entryName}
            onChangeText={setEntryName}
            autoCapitalize="words"
            editable={!uploadingVideo}
          />

          <TextInput
            style={styles.input}
            placeholder="Participant email"
            value={entryEmail}
            onChangeText={setEntryEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!uploadingVideo}
          />

          <Pressable
            style={[
              styles.secondaryButton,
              pickingVideo && styles.disabledButton,
            ]}
            onPress={handleChooseVideo}
            disabled={pickingVideo || uploadingVideo}
          >
            <Text style={styles.secondaryButtonText}>
              {pickingVideo ? "Opening files..." : "Choose Dance Video"}
            </Text>
          </Pressable>

          {selectedVideo && (
            <View style={styles.selectedFile}>
              <Text style={styles.selectedFileName} numberOfLines={2}>
                {selectedVideo.name}
              </Text>

              <Pressable onPress={() => setSelectedVideo(null)}>
                <Text style={styles.removeFile}>Remove</Text>
              </Pressable>
            </View>
          )}

          <Pressable
            style={[
              styles.registerButton,
              uploadingVideo && styles.disabledButton,
            ]}
            onPress={handleUploadVideo}
            disabled={uploadingVideo || pickingVideo}
          >
            <Text style={styles.buttonText}>
              {uploadingVideo ? "Uploading..." : "Upload Entry"}
            </Text>
          </Pressable>

          <Text style={styles.uploadNote}>
            Maximum video size: 100 MB. The file will be saved on the backend
            computer. Uploading does not complete payment.
          </Text>
        </View>

        {/* Registration */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>
            Register for this competition
          </Text>

          <Text style={styles.formNote}>
            Enter your details to create a registration. Payment is not taken
            in this demo flow.
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Full name"
            value={participantName}
            onChangeText={setParticipantName}
            autoCapitalize="words"
            editable={!registering && !registrationClosed}
          />

          <TextInput
            style={styles.input}
            placeholder="Email address"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!registering && !registrationClosed}
          />

          <Pressable
            style={[
              styles.registerButton,
              (registering || registrationClosed) && styles.disabledButton,
            ]}
            onPress={handleRegister}
            disabled={registering || registrationClosed}
          >
            <Text style={styles.buttonText}>
              {registering
                ? "Registering..."
                : competition.isFull
                ? "Competition Full"
                : competition.registrationStatus !== "open"
                ? "Registration Closed"
                : "Register Now"}
            </Text>
          </Pressable>
        </View>

        <Text style={styles.note}>
          Competition details are loaded from your Feedants backend.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F6FA",
  },
  content: {
    padding: 20,
    paddingTop: 32,
    paddingBottom: 36,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  message: {
    marginTop: 12,
    color: "#555",
  },
  error: {
    color: "#B42318",
    textAlign: "center",
  },
  category: {
    color: "#6558D3",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#171717",
    marginTop: 8,
  },
  description: {
    fontSize: 15,
    color: "#777",
    lineHeight: 22,
    marginTop: 10,
  },
  statusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 18,
  },
  status: {
    backgroundColor: "#E8E5FF",
    color: "#5145CD",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    overflow: "hidden",
    fontSize: 12,
    fontWeight: "600",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 20,
    marginTop: 24,
    elevation: 2,
  },
  label: {
    color: "#777",
    fontSize: 13,
  },
  prize: {
    fontSize: 32,
    fontWeight: "800",
    color: "#171717",
    marginTop: 5,
  },
  divider: {
    height: 1,
    backgroundColor: "#EEEEEE",
    marginVertical: 18,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    gap: 12,
  },
  value: {
    color: "#222",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "right",
    flexShrink: 1,
  },
  tabsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 24,
  },
  tabButton: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#E5E5E5",
  },
  activeTabButton: {
    backgroundColor: "#6558D3",
    borderColor: "#6558D3",
  },
  tabText: {
    color: "#555",
    fontSize: 13,
    fontWeight: "600",
  },
  activeTabText: {
    color: "#FFFFFF",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#171717",
  },
  formNote: {
    color: "#777",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
    marginBottom: 14,
  },
  input: {
    borderWidth: 1,
    borderColor: "#DDDDDD",
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginTop: 12,
  },
  registerButton: {
    backgroundColor: "#6558D3",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 16,
  },
  disabledButton: {
    backgroundColor: "#AAA5D9",
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  retryButton: {
    backgroundColor: "#6558D3",
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: 16,
  },
  note: {
    textAlign: "center",
    color: "#888",
    fontSize: 12,
    marginTop: 20,
  },
  personRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 24,
    gap: 12,
  },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "#E8E5FF",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#6558D3",
    fontSize: 18,
    fontWeight: "700",
  },
  personInfo: {
    flex: 1,
  },
  personName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#222",
  },
  personRole: {
    fontSize: 14,
    color: "#777",
    marginTop: 5,
    lineHeight: 20,
  },
  winnerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: 20,
  },
  winnerMedal: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: "#FFF1C2",
    color: "#8A6200",
    textAlign: "center",
    textAlignVertical: "center",
    fontSize: 22,
    fontWeight: "800",
    overflow: "hidden",
  },
  secondaryButton: {
    backgroundColor: "#EEEAFE",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 18,
  },
  secondaryButtonText: {
    color: "#6558D3",
    fontSize: 16,
    fontWeight: "700",
  },
  selectedFile: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
    padding: 12,
    backgroundColor: "#F6F5FF",
    borderRadius: 10,
  },
  selectedFileName: {
    flex: 1,
    color: "#333",
    fontSize: 14,
    marginRight: 12,
  },
  removeFile: {
    color: "#D14343",
    fontWeight: "700",
  },
  uploadNote: {
    color: "#777",
    fontSize: 13,
    marginTop: 14,
    lineHeight: 19,
  },
});